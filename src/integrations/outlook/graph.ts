export interface ApplicationGraphConfig {
    authMode?: 'application';
    tenantId: string;
    clientId: string;
    clientSecret: string;
    mailbox: string;
}

export interface AccessTokenGraphConfig {
    authMode: 'access_token';
    accessToken: string;
    mailbox: string;
    ownerEmail: string;
    tokenSource?: 'oauth';
}

export type GraphConfig = ApplicationGraphConfig | AccessTokenGraphConfig;

export interface OAuthGraphConfig {
    authMode: 'oauth';
    tenantId: string;
    clientId: string;
    clientSecret: string;
    mailbox: string;
    ownerEmail: string;
    redirectUri: string;
}
export type OutlookConfig = GraphConfig | OAuthGraphConfig;

export interface MailMessage {
    id: string;
    subject?: string;
    from?: { emailAddress?: { name?: string; address?: string } };
    bodyPreview?: string;
    body?: { contentType: string; content: string };
    receivedDateTime?: string;
    hasAttachments?: boolean;
    isRead?: boolean;
    "@removed"?: unknown;
}

export interface MailPage {
    value: MailMessage[];
    "@odata.nextLink"?: string;
    "@odata.deltaLink"?: string;
}

export interface NewMessage { subject: string; body: string; to: string[]; cc: string[]; bcc: string[] }
export interface MailAttachment { id: string; name: string; size: number; contentType: string; '@odata.type'?: string }

// Bound downloads even when the upstream server omits Content-Length.
export async function readDownload(response: Response, limit = 25 * 1024 * 1024): Promise<Buffer> {
    if (Number(response.headers.get('content-length')) > limit) {
        await response.body?.cancel();
        throw new GraphError(413, 'Download exceeds the 25 MiB limit. Open it in Outlook.');
    }
    const reader = response.body?.getReader();
    if (!reader) return Buffer.alloc(0);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > limit) { await reader.cancel(); throw new GraphError(413, 'Download exceeds the 25 MiB limit. Open it in Outlook.'); }
            chunks.push(value);
        }
        return Buffer.concat(chunks);
    } finally { reader.releaseLock(); }
}

export class GraphError extends Error {
    constructor(public status: number, message: string) { super(message); }
}

// Graph emits both key-as-segment and OData key-predicate continuation URLs.
// Canonicalize only the path for comparison; send the original URL/token unchanged.
export function canonicalGraphPath(pathname: string): string {
    try {
        return decodeURIComponent(pathname)
            .replace(/\/(users|mailFolders|messages)\('((?:[^']|'')*)'\)(?=\/|$)/g,
                (_match, collection: string, key: string) => `/${collection}/${key.replace(/''/g, "'")}`)
            .replace(/\/mailFolders\/inbox\//i, '/mailFolders/inbox/');
    } catch { throw new GraphError(502, 'Invalid Microsoft synchronization cursor.'); }
}

export function createGraphClient(config: GraphConfig, request: typeof fetch = fetch) {
    let token: { value: string; expiresAt: number } | undefined;
    const path = config.authMode === 'access_token'
        ? '/v1.0/me/mailFolders/inbox/messages/delta'
        : `/v1.0/users/${encodeURIComponent(config.mailbox)}/mailFolders/inbox/messages/delta`;
    const initial = new URL(`https://graph.microsoft.com${path}`);
    initial.searchParams.set('$select', 'id,subject,from,bodyPreview,body,receivedDateTime,hasAttachments,isRead');

    async function accessToken() {
        if (config.authMode === 'access_token') return config.accessToken;
        if (token && token.expiresAt > Date.now() + 60_000) return token.value;
        const response = await request(`https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`, {
            method: 'POST',
            body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret,
                grant_type: 'client_credentials', scope: 'https://graph.microsoft.com/.default' }),
            signal: AbortSignal.timeout(30_000),
            redirect: 'error',
        });
        if (!response.ok) throw new GraphError(502, 'Microsoft authentication failed. Check the app credentials and tenant.');
        const data = await response.json() as { access_token?: string; expires_in?: number };
        if (!data.access_token || typeof data.expires_in !== 'number') throw new GraphError(502, 'Invalid Microsoft token response.');
        token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
        return token.value;
    }

    const expiredTokenMessage = config.authMode !== 'access_token'
        ? 'Microsoft rejected the application token. Check the tenant, client secret and mailbox permissions.'
        : config.tokenSource === 'oauth'
            ? 'Microsoft rejected the Outlook authorization. Reconnect Microsoft Outlook in Settings.'
            : 'The Outlook access token expired or was rejected. Save a fresh Graph Explorer token in Settings (or update GRAPH_ACCESS_TOKEN and restart if using environment configuration).';
    let verifiedAccountPath: string | undefined;

    async function verifyPersonalMailbox() {
        if (config.authMode !== 'access_token' || verifiedAccountPath) return;
        const response = await request('https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName', {
            headers: { Authorization: `Bearer ${config.accessToken}` },
            signal: AbortSignal.timeout(30_000), redirect: 'error',
        });
        if (response.status === 401) throw new GraphError(502, expiredTokenMessage);
        if (response.status === 429) throw new GraphError(429, 'Microsoft is limiting requests. Wait before syncing again.');
        if (!response.ok) throw new GraphError(502, 'Could not verify the Outlook account. The connection needs delegated User.Read permission.');
        const profile = await response.json() as { id?: string; mail?: string; userPrincipalName?: string };
        const addresses = [profile.mail, profile.userPrincipalName].filter(value => typeof value === 'string').map(value => value!.toLowerCase());
        if (!profile.id || !addresses.includes(config.mailbox.toLowerCase())) {
            throw new GraphError(502, 'The token belongs to a different mailbox. Set GRAPH_MAILBOX to the mail or userPrincipalName returned by /me in Graph Explorer.');
        }
        verifiedAccountPath = `/v1.0/users/${encodeURIComponent(profile.id)}/mailFolders/inbox/messages/delta`;
    }

    async function page(cursor?: string | null): Promise<MailPage> {
        let url: URL;
        try { url = new URL(cursor || initial.href); }
        catch { throw new GraphError(502, 'Invalid Microsoft synchronization cursor.'); }
        // A stored continuation URL must never send our bearer token to another host.
        if (url.origin !== initial.origin || url.username || url.password || url.hash) {
            throw new GraphError(502, 'Invalid Microsoft synchronization cursor.');
        }
        await verifyPersonalMailbox();
        if (![path, verifiedAccountPath].some(allowed => allowed && canonicalGraphPath(url.pathname) === canonicalGraphPath(allowed))) {
            throw new GraphError(502, 'Invalid Microsoft synchronization cursor.');
        }
        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await request(url, {
                headers: { Authorization: `Bearer ${await accessToken()}`,
                    Prefer: 'outlook.body-content-type="text", IdType="ImmutableId", odata.maxpagesize=50' },
                signal: AbortSignal.timeout(30_000), redirect: 'error',
            });
            if (response.status === 401 && config.authMode === 'access_token') throw new GraphError(502, expiredTokenMessage);
            if (response.status === 401 && attempt === 0) { token = undefined; continue; }
            if (response.status === 410) throw new GraphError(410, 'Mailbox sync expired. Sync again to rebuild the checkpoint.');
            if (response.status === 429) throw new GraphError(429, 'Microsoft is limiting requests. Wait before syncing again.');
            if (!response.ok) throw new GraphError(502, `Microsoft mail request failed (${response.status}). Check mailbox access and Mail.Read permission.`);
            const data = await response.json() as MailPage;
            if (!Array.isArray(data.value) || !(data['@odata.nextLink'] || data['@odata.deltaLink'])) {
                throw new GraphError(502, 'Invalid Microsoft mail response.');
            }
            return data;
        }
        throw new GraphError(502, 'Microsoft authentication failed.');
    }
    const root = config.authMode === 'access_token' ? 'me' : `users/${encodeURIComponent(config.mailbox)}`;
    async function post(path: string, body: unknown) {
        await verifyPersonalMailbox();
        // Never automatically retry a send: a timeout may happen after Microsoft accepted it.
        const response = await request(`https://graph.microsoft.com/v1.0/${root}/${path}`, {
            method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
            headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json', Prefer: 'IdType="ImmutableId"' },
            body: JSON.stringify(body),
        });
        if (response.status === 401) { token = undefined; throw new GraphError(502, expiredTokenMessage); }
        if (response.status === 403) throw new GraphError(403, config.authMode !== 'access_token'
            ? 'Microsoft denied sending. Check application Mail.Send consent and mailbox access scope.'
            : config.tokenSource === 'oauth' ? 'Microsoft denied sending. Reconnect Outlook and consent to Mail.Send.'
                : 'Microsoft denied sending. Consent to Mail.Send in Graph Explorer, then save the new token in Settings.');
        if (response.status === 404) throw new GraphError(404, 'The original email no longer exists in Outlook.');
        if (response.status === 429) throw new GraphError(429, 'Microsoft is limiting sending. Wait before trying again.');
        if (response.status >= 500) throw new Error('Microsoft sending result is uncertain.');
        if (response.status !== 202) throw new GraphError(502, `Microsoft did not accept the message (${response.status}).`);
    }
    async function send(id: string, action: 'reply' | 'forward', comment: string, recipients: string[]) {
        await post(`messages/${encodeURIComponent(id)}/${action}`, action === 'reply' ? { comment } : { comment, toRecipients: recipients.map(address => ({ emailAddress: { address } })) });
    }
    async function compose(message: NewMessage) {
        const addresses = (values: string[]) => values.map(address => ({ emailAddress: { address } }));
        await post('sendMail', { message: { subject: message.subject, body: { contentType: 'Text', content: message.body },
            toRecipients: addresses(message.to), ccRecipients: addresses(message.cc), bccRecipients: addresses(message.bcc) }, saveToSentItems: true });
    }
    async function read(url: string, html = false) {
        await verifyPersonalMailbox();
        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await request(url, { headers: { Authorization: `Bearer ${await accessToken()}`, Prefer: `IdType="ImmutableId"${html ? ', outlook.body-content-type="html"' : ''}` },
                redirect: 'error', signal: AbortSignal.timeout(30_000) });
            if (response.status === 401 && config.authMode !== 'access_token' && attempt === 0) { token = undefined; continue; }
            if (response.status === 401) throw new GraphError(502, expiredTokenMessage);
            if (response.status === 404) throw new GraphError(404, 'This message or attachment no longer exists in Outlook.');
            if (response.status === 429) throw new GraphError(429, 'Microsoft is limiting requests. Try again later.');
            if (!response.ok) throw new GraphError(502, 'Microsoft download failed. Check Mail.Read permission.');
            return response;
        }
        throw new GraphError(502, 'Microsoft authentication failed.');
    }
    const messageUrl = (id: string) => `https://graph.microsoft.com/v1.0/${root}/messages/${encodeURIComponent(id)}`;
    async function attachments(id: string) {
        const base = `${messageUrl(id)}/attachments`;
        let url: string | undefined = `${base}?$select=id,name,size,contentType&$top=100`;
        const result: MailAttachment[] = [];
        for (let pages = 0; url && pages < 10; pages++) {
            const target = new URL(url);
            if (target.origin !== 'https://graph.microsoft.com' || canonicalGraphPath(target.pathname) !== canonicalGraphPath(new URL(base).pathname) || target.username || target.password || target.hash) throw new GraphError(502, 'Invalid attachment continuation.');
            const data = await (await read(url)).json() as { value?: MailAttachment[]; '@odata.nextLink'?: string };
            if (!Array.isArray(data.value)) throw new GraphError(502, 'Invalid attachment response.');
            result.push(...data.value.map(item => ({ id: item.id, name: item.name, size: item.size, contentType: item.contentType,
                ...(item['@odata.type'] ? { '@odata.type': item['@odata.type'] } : {}) })));
            url = data['@odata.nextLink'];
        }
        if (url) throw new GraphError(413, 'Too many attachments. Open this message in Outlook.');
        return result;
    }
    async function attachment(id: string, attachmentId: string) {
        const item = (await attachments(id)).find(value => value.id === attachmentId);
        if (!item) throw new GraphError(404, 'Attachment not found.');
        if (item['@odata.type']?.endsWith('referenceAttachment')) throw new GraphError(400, 'Open cloud-link attachments in Outlook.');
        const data = await readDownload(await read(`${messageUrl(id)}/attachments/${encodeURIComponent(attachmentId)}/$value`));
        return { name: item.name, data };
    }
    async function mime(id: string) { return readDownload(await read(`${messageUrl(id)}/$value`)); }
    async function body(id: string) {
        const bytes = await readDownload(await read(`${messageUrl(id)}?$select=body`, true), 5 * 1024 * 1024);
        let data: MailMessage;
        try { data = JSON.parse(bytes.toString('utf8')); }
        catch { throw new GraphError(502, 'Invalid Microsoft message body.'); }
        if (!data?.body || typeof data.body.content !== 'string' || !['html', 'text'].includes(data.body.contentType?.toLowerCase())) {
            throw new GraphError(502, 'Invalid Microsoft message body.');
        }
        return data.body;
    }
    return { page, send, compose, attachments, attachment, mime, body };
}
