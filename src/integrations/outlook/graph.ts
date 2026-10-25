import { MailError } from '../mail/errors.js';
import { readDownload } from '../mail/http.js';
import { recipientLabel } from '../mail/mime.js';
import {
    INITIAL_SYNC_DAYS,
    type MailAttachment,
    type MailBody,
    type MailClient,
    type MailFolder,
    mailFolders,
    type NewMessage,
    type SyncedFields,
    type SyncedMessage,
    type SyncPage,
} from '../mail/types.js';

export class GraphError extends MailError {}

interface GraphMessage {
    id: string;
    subject?: string;
    from?: { emailAddress?: { name?: string; address?: string } };
    toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>;
    bodyPreview?: string;
    body?: { contentType: string; content: string };
    receivedDateTime?: string;
    hasAttachments?: boolean;
    isRead?: boolean;
    '@removed'?: unknown;
}
interface GraphPage {
    value: GraphMessage[];
    '@odata.nextLink'?: string;
    '@odata.deltaLink'?: string;
}

const ORIGIN = 'https://graph.microsoft.com';
const ROOT = `${ORIGIN}/v1.0/me`;
// Graph's well-known folder names. Each folder has its own delta checkpoint.
const GRAPH_FOLDERS: Record<MailFolder, string> = { inbox: 'inbox', sent: 'sentitems', junk: 'junkemail' };
const deltaPath = (folder: MailFolder) => new RegExp(`^/v1\\.0/(?:me|users/[^/]+)/mailFolders/${GRAPH_FOLDERS[folder]}/messages/delta$`);
const ATTACHMENTS_PATH = /^\/v1\.0\/(?:me|users\/[^/]+)\/messages\/[^/]+\/attachments$/;
const SELECT = 'id,subject,from,toRecipients,bodyPreview,body,receivedDateTime,hasAttachments,isRead';

// Graph emits both key-as-segment and OData key-predicate continuation URLs.
// Canonicalize only the path for comparison; send the original URL unchanged.
export function canonicalGraphPath(pathname: string): string {
    try {
        return decodeURIComponent(pathname)
            .replace(
                /\/(users|mailFolders|messages)\('((?:[^']|'')*)'\)(?=\/|$)/g,
                (_match, collection: string, key: string) => `/${collection}/${key.replace(/''/g, "'")}`,
            )
            .replace(/\/mailFolders\/(inbox|sentitems|junkemail)\//i, (_match, name: string) => `/mailFolders/${name.toLowerCase()}/`);
    } catch {
        throw new GraphError(502, 'Invalid Microsoft synchronization cursor.');
    }
}

// A delta only covers its own folder, so a removal means "left this folder" (it may have moved to another one).
export function toSyncedMessage(message: GraphMessage, folder: MailFolder): SyncedMessage {
    if (message['@removed']) return { id: message.id, folder, removed: true, fields: {} };
    const fields: Partial<SyncedFields> = {};
    if ('subject' in message) fields.subject = message.subject ?? '';
    if ('from' in message)
        fields.sender = { name: message.from?.emailAddress?.name ?? '', address: message.from?.emailAddress?.address ?? '' };
    if ('toRecipients' in message) fields.recipients = recipientLabel((message.toRecipients ?? []).map(item => item.emailAddress ?? {}));
    if ('bodyPreview' in message) fields.preview = message.bodyPreview ?? '';
    if ('body' in message) fields.bodyText = message.body?.content ?? '';
    if ('receivedDateTime' in message) fields.receivedAt = message.receivedDateTime ?? null;
    if ('hasAttachments' in message) fields.hasAttachments = Boolean(message.hasAttachments);
    if ('isRead' in message) fields.isRead = Boolean(message.isRead);
    return { id: message.id, folder, fields };
}

export function createGraphClient(
    getToken: () => Promise<string>,
    request: typeof fetch = fetch,
    now: () => number = Date.now,
): MailClient {
    function initialUrl(folder: MailFolder) {
        const since = new Date(now() - INITIAL_SYNC_DAYS * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
        return `${ROOT}/mailFolders/${GRAPH_FOLDERS[folder]}/messages/delta?$select=${SELECT}&$filter=receivedDateTime%20ge%20${since}`;
    }

    interface Call {
        method?: string;
        body?: unknown;
        prefer?: string[];
        write?: boolean;
        uncertain?: boolean;
    }
    // One place for status handling. Sends are never retried: a timeout may follow acceptance.
    async function call(url: string | URL, options: Call = {}): Promise<Response> {
        const headers: Record<string, string> = {
            Authorization: `Bearer ${await getToken()}`,
            Prefer: ['IdType="ImmutableId"', ...(options.prefer ?? [])].join(', '),
        };
        if (options.body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await request(url, {
            method: options.method ?? 'GET',
            headers,
            redirect: 'error',
            signal: AbortSignal.timeout(30_000),
            ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        });
        if (response.status === 401)
            throw new GraphError(502, 'Microsoft rejected the sign-in for this account. Reconnect it in Settings.', true);
        if (response.status === 403)
            throw new GraphError(
                403,
                options.write
                    ? 'Microsoft denied this action. Reconnect the account in Settings and accept every requested permission.'
                    : 'Microsoft denied access to this mailbox. Reconnect the account in Settings.',
                options.write !== true,
            );
        if (response.status === 404) throw new GraphError(404, 'This message or attachment no longer exists in Outlook.');
        if (response.status === 410) throw new GraphError(410, 'Mailbox sync expired. Sync again to rebuild the checkpoint.');
        if (response.status === 429) throw new GraphError(429, 'Microsoft is limiting requests. Wait a moment and try again.');
        if (response.status >= 500 && options.uncertain) throw new Error('Microsoft sending result is uncertain.');
        return response;
    }

    // The stored cursor holds one continuation URL per folder: {"inbox": "...", "sent": "...", "junk": "..."}.
    function parseCursor(cursor: string | null): Partial<Record<MailFolder, string>> {
        if (!cursor) return {};
        // Before Sent and Junk were synced the cursor was the inbox URL alone; rebuild it from scratch.
        if (cursor.startsWith('https://')) throw new GraphError(410, 'Mailbox sync expired. Sync again to rebuild the checkpoint.');
        let parsed: unknown;
        try {
            parsed = JSON.parse(cursor);
        } catch {
            throw new GraphError(502, 'Invalid Microsoft synchronization cursor.');
        }
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
            throw new GraphError(502, 'Invalid Microsoft synchronization cursor.');
        const links: Partial<Record<MailFolder, string>> = {};
        for (const folder of mailFolders) {
            const value = (parsed as Record<string, unknown>)[folder];
            if (value === undefined) continue;
            if (typeof value !== 'string') throw new GraphError(502, 'Invalid Microsoft synchronization cursor.');
            links[folder] = value;
        }
        return links;
    }

    // A stored continuation URL must never send our bearer token to another host, or read another folder.
    function deltaUrl(folder: MailFolder, link: string | undefined): URL {
        let url: URL;
        try {
            url = new URL(link ?? initialUrl(folder));
        } catch {
            throw new GraphError(502, 'Invalid Microsoft synchronization cursor.');
        }
        if (url.origin !== ORIGIN || url.username || url.password || url.hash || !deltaPath(folder).test(canonicalGraphPath(url.pathname)))
            throw new GraphError(502, 'Invalid Microsoft synchronization cursor.');
        return url;
    }

    // One page of every folder per call. Every link is checked before the first request is made.
    async function sync(cursor: string | null): Promise<SyncPage> {
        const links = parseCursor(cursor);
        const urls = mailFolders.map(folder => [folder, deltaUrl(folder, links[folder])] as const);
        const messages: SyncedMessage[] = [];
        let hasMore = false;
        for (const [folder, url] of urls) {
            const response = await call(url, { prefer: ['outlook.body-content-type="text"', 'odata.maxpagesize=50'] });
            if (!response.ok) throw new GraphError(502, `Microsoft mail request failed (${response.status}).`);
            const data = (await response.json()) as GraphPage;
            const next = data['@odata.nextLink'];
            const checkpoint = next ?? data['@odata.deltaLink'];
            if (!Array.isArray(data.value) || !checkpoint) throw new GraphError(502, 'Invalid Microsoft mail response.');
            messages.push(...data.value.map(message => toSyncedMessage(message, folder)));
            links[folder] = checkpoint;
            hasMore ||= Boolean(next);
        }
        return { messages, cursor: JSON.stringify(links), hasMore };
    }

    const messageUrl = (id: string) => `${ROOT}/messages/${encodeURIComponent(id)}`;

    async function send(id: string, action: 'reply' | 'forward', comment: string, recipients: string[]) {
        const body =
            action === 'reply' ? { comment } : { comment, toRecipients: recipients.map(address => ({ emailAddress: { address } })) };
        const response = await call(`${messageUrl(id)}/${action}`, { method: 'POST', body, write: true, uncertain: true });
        if (response.status !== 202) throw new GraphError(502, `Microsoft did not accept the message (${response.status}).`);
    }

    async function compose(message: NewMessage) {
        const addresses = (values: string[]) => values.map(address => ({ emailAddress: { address } }));
        const response = await call(`${ROOT}/sendMail`, {
            method: 'POST',
            write: true,
            uncertain: true,
            body: {
                message: {
                    subject: message.subject,
                    body: { contentType: 'Text', content: message.body },
                    toRecipients: addresses(message.to),
                    ccRecipients: addresses(message.cc),
                    bccRecipients: addresses(message.bcc),
                },
                saveToSentItems: true,
            },
        });
        if (response.status !== 202) throw new GraphError(502, `Microsoft did not accept the message (${response.status}).`);
    }

    async function setRead(id: string, isRead: boolean) {
        const response = await call(messageUrl(id), { method: 'PATCH', body: { isRead }, write: true });
        if (!response.ok) throw new GraphError(502, `Microsoft could not update the message (${response.status}).`);
    }

    async function attachments(id: string): Promise<MailAttachment[]> {
        let url: string | undefined = `${messageUrl(id)}/attachments?$select=id,name,size,contentType&$top=100`;
        const result: MailAttachment[] = [];
        for (let pages = 0; url && pages < 10; pages++) {
            const target = new URL(url);
            if (
                target.origin !== ORIGIN ||
                target.username ||
                target.password ||
                target.hash ||
                !ATTACHMENTS_PATH.test(canonicalGraphPath(target.pathname))
            )
                throw new GraphError(502, 'Invalid attachment continuation.');
            const response = await call(url);
            if (!response.ok) throw new GraphError(502, 'Microsoft attachment request failed.');
            const data = (await response.json()) as {
                value?: Array<MailAttachment & { '@odata.type'?: string }>;
                '@odata.nextLink'?: string;
            };
            if (!Array.isArray(data.value)) throw new GraphError(502, 'Invalid attachment response.');
            result.push(
                ...data.value.map(item => ({
                    id: item.id,
                    name: item.name,
                    size: item.size,
                    contentType: item.contentType,
                    ...(item['@odata.type']?.endsWith('referenceAttachment') ? { cloudLink: true } : {}),
                })),
            );
            url = data['@odata.nextLink'];
        }
        if (url) throw new GraphError(413, 'Too many attachments. Open this message in Outlook.');
        return result;
    }

    async function attachment(id: string, attachmentId: string) {
        const item = (await attachments(id)).find(value => value.id === attachmentId);
        if (!item) throw new GraphError(404, 'Attachment not found.');
        if (item.cloudLink) throw new GraphError(400, 'Open cloud-link attachments in Outlook.');
        const response = await call(`${messageUrl(id)}/attachments/${encodeURIComponent(attachmentId)}/$value`);
        if (!response.ok) throw new GraphError(502, 'Microsoft download failed.');
        return { name: item.name, data: await readDownload(response) };
    }

    async function mime(id: string) {
        const response = await call(`${messageUrl(id)}/$value`);
        if (!response.ok) throw new GraphError(502, 'Microsoft download failed.');
        return readDownload(response);
    }

    async function body(id: string): Promise<MailBody> {
        const response = await call(`${messageUrl(id)}?$select=body`, { prefer: ['outlook.body-content-type="html"'] });
        if (!response.ok) throw new GraphError(502, 'Microsoft message request failed.');
        const bytes = await readDownload(response, 5 * 1024 * 1024);
        let data: GraphMessage;
        try {
            data = JSON.parse(bytes.toString('utf8'));
        } catch {
            throw new GraphError(502, 'Invalid Microsoft message body.');
        }
        const type = data?.body?.contentType?.toLowerCase();
        if (!data?.body || typeof data.body.content !== 'string' || (type !== 'html' && type !== 'text'))
            throw new GraphError(502, 'Invalid Microsoft message body.');
        return { contentType: type, content: data.body.content };
    }

    return { sync, send, compose, setRead, attachments, attachment, mime, body };
}
