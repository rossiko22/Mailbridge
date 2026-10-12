import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { createGraphClient, GraphError, type OutlookConfig, type NewMessage } from './graph.js';
import { createOAuthConnection, type OAuthState } from './oauth.js';

export interface OutlookConnection extends ReturnType<typeof createGraphClient> {
    status(): Promise<{ mailbox: string; mode: string; source: string; updatedAt: unknown }>;
    saveToken(token: string): Promise<void>;
    beginOAuth?: () => Promise<{ url: string; pending: OAuthState }>;
    completeOAuth?: (code: string, pending: OAuthState) => Promise<void>;
}

export function tokenVault(secret: string, mailbox: string) {
    const key = createHash('sha256').update(`outlook-token-v1:${secret}`).digest();
    return {
        encrypt(value: string) {
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(Buffer.from(mailbox));
            const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
            return [iv, cipher.getAuthTag(), data].map(item => item.toString('base64')).join('.');
        },
        decrypt(value: string) {
            const [iv, tag, data] = value.split('.').map(item => Buffer.from(item, 'base64'));
            if (!iv || !tag || !data) throw new Error('Invalid encrypted Outlook token');
            const cipher = createDecipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(Buffer.from(mailbox));
            cipher.setAuthTag(tag);
            return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
        },
    };
}

export function createOutlookConnection(pool: Pool, config: OutlookConfig, secret: string, makeClient = createGraphClient): OutlookConnection {
    if (config.authMode === 'oauth') return createOAuthConnection(pool, config, secret);
    const vault = tokenVault(secret, config.mailbox);
    let cachedToken: string | undefined;
    let cachedClient = makeClient(config);
    async function client() {
        if (config.authMode !== 'access_token') return cachedClient;
        const { rows } = await pool.query('SELECT encrypted_token FROM outlook_connections WHERE mailbox=$1', [config.mailbox]);
        const token = rows[0] ? vault.decrypt(rows[0].encrypted_token) : config.accessToken;
        if (token !== cachedToken) {
            cachedClient = makeClient({ ...config, accessToken: token });
            cachedToken = token;
        }
        return cachedClient;
    }
    async function saveToken(token: string) {
        if (config.authMode !== 'access_token') throw new GraphError(400, 'Token settings are available in personal Outlook mode.');
        if (!token || token.length > 30000 || /\s/.test(token)) throw new GraphError(400, 'Paste only the access token, without the Bearer prefix.');
        // Validate account ownership and read access before replacing the working token.
        await makeClient({ ...config, accessToken: token }).page();
        await pool.query(`INSERT INTO outlook_connections (mailbox,encrypted_token) VALUES ($1,$2)
            ON CONFLICT (mailbox) DO UPDATE SET encrypted_token=EXCLUDED.encrypted_token, updated_at=NOW()`, [config.mailbox, vault.encrypt(token)]);
    }
    async function status() {
        const { rows } = await pool.query('SELECT updated_at FROM outlook_connections WHERE mailbox=$1', [config.mailbox]);
        return { mailbox: config.mailbox, mode: config.authMode ?? 'application', source: rows[0] ? 'settings' : 'environment', updatedAt: rows[0]?.updated_at ?? null };
    }
    return { page: async (cursor?: string | null) => (await client()).page(cursor),
        compose: async (message: NewMessage) => (await client()).compose(message),
        attachments: async (id: string) => (await client()).attachments(id),
        attachment: async (id: string, attachmentId: string) => (await client()).attachment(id, attachmentId),
        mime: async (id: string) => (await client()).mime(id),
        body: async (id: string) => (await client()).body(id),
        send: async (id: string, action: 'reply' | 'forward', comment: string, recipients: string[]) => (await client()).send(id, action, comment, recipients), saveToken, status };
}
