import { ConfidentialClientApplication } from '@azure/msal-node';
import { createHash, randomBytes } from 'node:crypto';
import type { Pool } from 'pg';
import { createGraphClient, GraphError, type OAuthGraphConfig } from './graph.js';
import { tokenVault } from './connection.js';

const scopes = ['https://graph.microsoft.com/User.Read', 'https://graph.microsoft.com/Mail.Read', 'https://graph.microsoft.com/Mail.Send', 'offline_access'];
export type OAuthState = { state: string; verifier: string; expiresAt: number };
const makeMsal = (config: OAuthGraphConfig) => new ConfidentialClientApplication({
    auth: { clientId: config.clientId, clientSecret: config.clientSecret, authority: `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}` },
    system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } },
});

export function createOAuthConnection(pool: Pool, config: OAuthGraphConfig, secret: string,
    factory = makeMsal, makeGraph = createGraphClient) {
    const vault = tokenVault(secret, `oauth:${config.mailbox}`);
    const graph = (accessToken: string) => makeGraph({ authMode: 'access_token', accessToken, mailbox: config.mailbox, ownerEmail: config.ownerEmail, tokenSource: 'oauth' });

    async function beginOAuth() {
        const state = randomBytes(32).toString('base64url');
        const verifier = randomBytes(48).toString('base64url');
        const url = await factory(config).getAuthCodeUrl({ scopes, redirectUri: config.redirectUri, state, prompt: 'select_account', loginHint: config.mailbox,
            codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256' });
        return { url, pending: { state, verifier, expiresAt: Date.now() + 10 * 60_000 } };
    }

    async function token(code?: string, verifier?: string) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            // A database lock serializes cache updates/refreshes across application processes.
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`oauth:${config.mailbox}`]);
            const msal = factory(config);
            const cache = msal.getTokenCache();
            let result;
            if (code && verifier) {
                result = await msal.acquireTokenByCode({ code, codeVerifier: verifier, scopes, redirectUri: config.redirectUri });
                if (!result?.accessToken || !result.account) throw new GraphError(502, 'Microsoft did not provide an account and access token.');
                // Verify the signed-in Microsoft account matches the configured mailbox before persisting any tokens.
                await graph(result.accessToken).page();
            } else {
                const { rows } = await client.query('SELECT encrypted_cache,account_id FROM outlook_oauth WHERE mailbox=$1', [config.mailbox]);
                if (!rows[0]) throw new GraphError(503, 'Connect Microsoft Outlook in Settings first.');
                cache.deserialize(vault.decrypt(rows[0].encrypted_cache));
                const account = await cache.getAccountByHomeId(rows[0].account_id);
                if (!account) throw new GraphError(503, 'Reconnect Microsoft Outlook in Settings.');
                result = await msal.acquireTokenSilent({ account, scopes });
                if (!result?.accessToken || !result.account) throw new GraphError(503, 'Reconnect Microsoft Outlook in Settings.');
            }
            await client.query(`INSERT INTO outlook_oauth(mailbox,encrypted_cache,account_id) VALUES ($1,$2,$3)
                ON CONFLICT (mailbox) DO UPDATE SET encrypted_cache=EXCLUDED.encrypted_cache,account_id=EXCLUDED.account_id,updated_at=NOW()`,
                [config.mailbox,vault.encrypt(cache.serialize()),result.account.homeAccountId]);
            await client.query('COMMIT');
            return result.accessToken;
        } catch (error) {
            await client.query('ROLLBACK');
            if (error instanceof GraphError) throw error;
            throw new GraphError(502, 'Microsoft authorization could not be renewed. Reconnect Outlook in Settings, or check the app registration and client secret.');
        } finally { client.release(); }
    }
    async function completeOAuth(code: string, pending: OAuthState) { await token(code, pending.verifier); }
    async function status() {
        const { rows } = await pool.query('SELECT updated_at FROM outlook_oauth WHERE mailbox=$1', [config.mailbox]);
        return { mailbox: config.mailbox, mode: 'oauth', source: rows[0] ? 'microsoft' : 'disconnected', updatedAt: rows[0]?.updated_at ?? null };
    }
    return { beginOAuth, completeOAuth, status,
        saveToken: async (_token: string) => { throw new GraphError(400, 'Use Connect Microsoft Outlook for OAuth mode.'); },
        page: async (cursor?: string | null) => graph(await token()).page(cursor),
        send: async (...args: Parameters<ReturnType<typeof createGraphClient>['send']>) => graph(await token()).send(...args),
        compose: async (...args: Parameters<ReturnType<typeof createGraphClient>['compose']>) => graph(await token()).compose(...args),
        attachments: async (id: string) => graph(await token()).attachments(id),
        attachment: async (id: string, attachmentId: string) => graph(await token()).attachment(id, attachmentId),
        mime: async (id: string) => graph(await token()).mime(id),
        body: async (id: string) => graph(await token()).body(id),
    };
}
