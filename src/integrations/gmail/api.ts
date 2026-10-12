import { MailError } from '../mail/errors.js';
import { readDownload } from '../mail/http.js';
import { base64UrlToBuffer, bufferToBase64Url, buildRawMessage, decodeEntities, decodeMimeWords, htmlToText, parseAddress, quoteText } from '../mail/mime.js';
import { DOWNLOAD_LIMIT, INITIAL_SYNC_DAYS, type MailAttachment, type MailBody, type MailClient, type NewMessage, type SyncedMessage, type SyncPage } from '../mail/types.js';

export class GmailError extends MailError {}

interface Header { name: string; value: string }
interface Part { mimeType?: string; filename?: string; headers?: Header[]; body?: { attachmentId?: string; size?: number; data?: string }; parts?: Part[] }
interface GmailMessage { id: string; threadId?: string; labelIds?: string[]; snippet?: string; internalDate?: string; payload?: Part; raw?: string }

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const FETCH_BATCH = 10;

const headerOf = (part: Part | undefined, name: string) => part?.headers?.find(item => item.name.toLowerCase() === name.toLowerCase())?.value;

function* walk(part: Part | undefined): Generator<Part> {
    if (!part) return;
    yield part;
    for (const child of part.parts ?? []) yield* walk(child);
}

function decodePart(part: Part): string {
    const charset = /charset="?([\w-]+)"?/i.exec(headerOf(part, 'Content-Type') ?? '')?.[1] ?? 'utf-8';
    const bytes = base64UrlToBuffer(part.body?.data ?? '');
    try { return new TextDecoder(charset.toLowerCase()).decode(bytes); } catch { return bytes.toString('utf8'); }
}

function findBody(payload: Part | undefined, type: 'text/html' | 'text/plain'): string | undefined {
    for (const part of walk(payload)) {
        if (part.mimeType === type && !part.filename && part.body?.data) return decodePart(part);
    }
    return undefined;
}

export function messageBody(payload: Part | undefined): MailBody {
    const html = findBody(payload, 'text/html');
    if (html !== undefined) return { contentType: 'html', content: html };
    return { contentType: 'text', content: findBody(payload, 'text/plain') ?? '' };
}

export function plainText(payload: Part | undefined): string {
    const text = findBody(payload, 'text/plain');
    if (text !== undefined) return text;
    const html = findBody(payload, 'text/html');
    return html === undefined ? '' : htmlToText(html);
}

function attachmentsOf(payload: Part | undefined): MailAttachment[] {
    const result: MailAttachment[] = [];
    for (const part of walk(payload)) {
        if (part.filename && part.body?.attachmentId) {
            result.push({ id: part.body.attachmentId, name: decodeMimeWords(part.filename), size: part.body.size ?? 0, contentType: part.mimeType ?? 'application/octet-stream' });
        }
    }
    return result;
}

export function toSyncedMessage(message: GmailMessage): SyncedMessage {
    // Archived, trashed or spam mail leaves the inbox view.
    if (!message.labelIds?.includes('INBOX')) return { id: message.id, removed: true, fields: {} };
    const payload = message.payload;
    return { id: message.id, fields: {
        subject: decodeMimeWords(headerOf(payload, 'Subject') ?? ''),
        sender: parseAddress(headerOf(payload, 'From')),
        preview: decodeEntities(message.snippet ?? ''),
        bodyText: plainText(payload).slice(0, 200_000),
        receivedAt: message.internalDate ? new Date(Number(message.internalDate)).toISOString() : null,
        hasAttachments: attachmentsOf(payload).length > 0,
        isRead: !message.labelIds.includes('UNREAD'),
    } };
}

type Cursor =
    | { mode: 'full'; startHistoryId: string; pageToken?: string }
    | { mode: 'delta'; historyId: string; pageToken?: string; latest?: string };

export function createGmailClient(getToken: () => Promise<string>, request: typeof fetch = fetch): MailClient {
    interface Call { method?: string; body?: unknown; write?: boolean; uncertain?: boolean; allow404?: boolean }
    async function call(path: string, options: Call = {}): Promise<Response> {
        const headers: Record<string, string> = { Authorization: `Bearer ${await getToken()}` };
        if (options.body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await request(`${API}/${path}`, {
            method: options.method ?? 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(30_000),
            ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
        });
        if (response.ok) return response;
        if (response.status === 401) throw new GmailError(502, 'Google rejected the sign-in for this account. Reconnect it in Settings.', true);
        if (response.status === 403) {
            const reason = await response.clone().json().then((data: { error?: { errors?: Array<{ reason?: string }>; status?: string } }) =>
                data.error?.errors?.[0]?.reason ?? data.error?.status ?? '', () => '');
            if (/ratelimit|quota/i.test(reason)) throw new GmailError(429, 'Google is limiting requests. Wait a moment and try again.');
            throw new GmailError(403, 'Google denied this action. Reconnect the account in Settings and allow every requested permission.', true);
        }
        if (response.status === 404 && options.allow404) return response;
        if (response.status === 404) throw new GmailError(404, 'This message or attachment no longer exists in Gmail.');
        if (response.status === 429) throw new GmailError(429, 'Google is limiting requests. Wait a moment and try again.');
        if (response.status >= 500 && options.uncertain) throw new Error('Google sending result is uncertain.');
        throw new GmailError(502, `Google request failed (${response.status}).`);
    }
    const json = async <T>(response: Response): Promise<T> => {
        try { return await response.json() as T; } catch { throw new GmailError(502, 'Invalid Google response.'); }
    };
    const getMessage = async (id: string, format: 'full' | 'raw', allow404 = false): Promise<GmailMessage | undefined> => {
        const response = await call(`messages/${encodeURIComponent(id)}?format=${format}`, { allow404 });
        return response.status === 404 ? undefined : json<GmailMessage>(response);
    };

    async function fetchMany(ids: string[]): Promise<SyncedMessage[]> {
        const result: SyncedMessage[] = [];
        for (let index = 0; index < ids.length; index += FETCH_BATCH) {
            const batch = await Promise.all(ids.slice(index, index + FETCH_BATCH).map(async id => {
                const message = await getMessage(id, 'full', true);
                return message ? toSyncedMessage(message) : { id, removed: true, fields: {} } satisfies SyncedMessage;
            }));
            result.push(...batch);
        }
        return result;
    }

    async function sync(stored: string | null): Promise<SyncPage> {
        let cursor: Cursor;
        try { cursor = stored ? JSON.parse(stored) as Cursor : { mode: 'full', startHistoryId: '' }; }
        catch { throw new GmailError(502, 'Invalid Gmail synchronization cursor.'); }

        if (cursor.mode === 'full') {
            // Capture the history position before listing so changes made meanwhile are caught by the next delta.
            const startHistoryId = cursor.startHistoryId || (await json<{ historyId?: string }>(await call('profile'))).historyId;
            if (!startHistoryId) throw new GmailError(502, 'Invalid Google profile response.');
            const query = `labelIds=INBOX&maxResults=50&q=${encodeURIComponent(`newer_than:${INITIAL_SYNC_DAYS}d`)}${cursor.pageToken ? `&pageToken=${encodeURIComponent(cursor.pageToken)}` : ''}`;
            const list = await json<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(await call(`messages?${query}`));
            const messages = await fetchMany((list.messages ?? []).map(item => item.id));
            const next: Cursor = list.nextPageToken ? { mode: 'full', startHistoryId, pageToken: list.nextPageToken } : { mode: 'delta', historyId: startHistoryId };
            return { messages, cursor: JSON.stringify(next), hasMore: Boolean(list.nextPageToken) };
        }

        if (!cursor.historyId) throw new GmailError(502, 'Invalid Gmail synchronization cursor.');
        const types = ['messageAdded', 'messageDeleted', 'labelAdded', 'labelRemoved'].map(type => `historyTypes=${type}`).join('&');
        const response = await call(`history?startHistoryId=${encodeURIComponent(cursor.historyId)}&maxResults=100&${types}${cursor.pageToken ? `&pageToken=${encodeURIComponent(cursor.pageToken)}` : ''}`, { allow404: true });
        // Gmail only keeps history for about a week; older checkpoints must be rebuilt.
        if (response.status === 404) throw new GmailError(410, 'Mailbox sync expired. Sync again to rebuild the checkpoint.');
        const data = await json<{ history?: Array<Record<string, Array<{ message?: { id: string } }> | string>>; nextPageToken?: string; historyId?: string }>(response);
        const ids = new Set<string>();
        for (const record of data.history ?? []) {
            for (const key of ['messagesAdded', 'messagesDeleted', 'labelsAdded', 'labelsRemoved']) {
                const entries = record[key];
                if (Array.isArray(entries)) for (const entry of entries) if (entry.message?.id) ids.add(entry.message.id);
            }
        }
        const messages = await fetchMany([...ids]);
        const latest = data.historyId ?? cursor.latest ?? cursor.historyId;
        const next: Cursor = data.nextPageToken
            ? { mode: 'delta', historyId: cursor.historyId, pageToken: data.nextPageToken, latest }
            : { mode: 'delta', historyId: latest };
        return { messages, cursor: JSON.stringify(next), hasMore: Boolean(data.nextPageToken) };
    }

    async function body(id: string): Promise<MailBody> {
        const message = await getMessage(id, 'full');
        return messageBody(message?.payload);
    }

    async function attachments(id: string): Promise<MailAttachment[]> {
        return attachmentsOf((await getMessage(id, 'full'))?.payload);
    }

    async function attachment(id: string, attachmentId: string) {
        const item = (await attachments(id)).find(value => value.id === attachmentId);
        if (!item) throw new GmailError(404, 'Attachment not found.');
        if (item.size > DOWNLOAD_LIMIT) throw new GmailError(413, 'Download exceeds the 25 MiB limit. Open it in Gmail.');
        const data = await json<{ data?: string }>(await call(`messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(attachmentId)}`));
        return { name: item.name, data: base64UrlToBuffer(data.data ?? '') };
    }

    async function mime(id: string): Promise<Buffer> {
        const response = await call(`messages/${encodeURIComponent(id)}?format=raw`);
        const bytes = await readDownload(response, Math.ceil(DOWNLOAD_LIMIT * 1.4));
        let data: GmailMessage;
        try { data = JSON.parse(bytes.toString('utf8')); } catch { throw new GmailError(502, 'Invalid Google response.'); }
        return base64UrlToBuffer(data.raw ?? '');
    }

    async function setRead(id: string, isRead: boolean) {
        await call(`messages/${encodeURIComponent(id)}/modify`, { method: 'POST', write: true,
            body: isRead ? { removeLabelIds: ['UNREAD'] } : { addLabelIds: ['UNREAD'] } });
    }

    async function transmit(raw: string, threadId?: string) {
        // Never retried automatically: a timeout may happen after Google accepted the message.
        await call('messages/send', { method: 'POST', write: true, uncertain: true,
            body: { raw: bufferToBase64Url(Buffer.from(raw)), ...(threadId ? { threadId } : {}) } });
    }

    async function send(id: string, action: 'reply' | 'forward', comment: string, recipients: string[]) {
        const original = await getMessage(id, 'full');
        if (!original) throw new GmailError(404, 'The original email no longer exists in Gmail.');
        const payload = original.payload;
        const subject = decodeMimeWords(headerOf(payload, 'Subject') ?? '');
        const from = parseAddress(headerOf(payload, 'From'));
        const fromLabel = from.name ? `${from.name} <${from.address}>` : from.address;
        const date = original.internalDate ? new Date(Number(original.internalDate)).toUTCString() : '';
        const text = plainText(payload).slice(0, 20_000);
        if (action === 'forward') {
            await transmit(buildRawMessage({ to: recipients, subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`,
                body: `${comment}\n\n---------- Forwarded message ----------\nFrom: ${fromLabel}\nDate: ${date}\nSubject: ${subject}\n\n${text}` }));
            return;
        }
        const target = parseAddress(headerOf(payload, 'Reply-To') || headerOf(payload, 'From'));
        if (!target.address) throw new GmailError(400, 'The original message has no reply address.');
        const messageId = headerOf(payload, 'Message-ID') ?? headerOf(payload, 'Message-Id');
        await transmit(buildRawMessage({
            to: [target.address], subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
            body: `${comment}\n\nOn ${date}, ${fromLabel} wrote:\n${quoteText(text)}`,
            ...(messageId ? { inReplyTo: messageId, references: [headerOf(payload, 'References'), messageId].filter(Boolean).join(' ') } : {}),
        }), original.threadId);
    }

    async function compose(message: NewMessage) {
        await transmit(buildRawMessage(message));
    }

    return { sync, body, attachments, attachment, mime, send, compose, setRead };
}
