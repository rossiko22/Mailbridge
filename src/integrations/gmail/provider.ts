import { createHash, randomBytes } from 'node:crypto';
import { MailError } from '../mail/errors.js';
import type { ConnectedProfile, CredentialStore, MailClient, MailProvider, PendingAuth } from '../mail/types.js';
import { createGmailClient, createQuotaBudget, type QuotaBudget } from './api.js';

export const gmailScopes = [
    'openid',
    'email',
    'profile',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.send',
];
const required = gmailScopes.filter(scope => scope.startsWith('https://'));

export interface GmailConfig {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
}
interface Stored {
    refreshToken: string;
    accessToken: string;
    expiresAt: number;
}
interface TokenResponse {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
}

const reconnect = () => new MailError(502, 'Google sign-in expired for this account. Reconnect it in Settings.', true);

export function createGmailProvider(
    config: GmailConfig,
    store: CredentialStore,
    request: typeof fetch = fetch,
    now: () => number = Date.now,
): MailProvider {
    async function token(params: Record<string, string>): Promise<{ status: number; data: TokenResponse }> {
        const response = await request('https://oauth2.googleapis.com/token', {
            method: 'POST',
            redirect: 'error',
            signal: AbortSignal.timeout(30_000),
            body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...params }),
        });
        const data = (await response.json().catch(() => ({}))) as TokenResponse;
        return { status: response.status, data };
    }

    async function begin() {
        const state = randomBytes(32).toString('base64url');
        const verifier = randomBytes(48).toString('base64url');
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
        url.search = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: config.redirectUri,
            response_type: 'code',
            scope: gmailScopes.join(' '),
            // A refresh token is only issued with offline access; consent makes it reliable on reconnect.
            access_type: 'offline',
            prompt: 'consent select_account',
            include_granted_scopes: 'true',
            state,
            code_challenge: createHash('sha256').update(verifier).digest('base64url'),
            code_challenge_method: 'S256',
        }).toString();
        const pending: PendingAuth = { provider: 'gmail', state, verifier, expiresAt: now() + 10 * 60_000 };
        return { url: url.href, pending };
    }

    async function complete(code: string, pending: PendingAuth): Promise<ConnectedProfile> {
        const { status, data } = await token({
            grant_type: 'authorization_code',
            code,
            redirect_uri: config.redirectUri,
            code_verifier: pending.verifier,
        });
        if (status !== 200 || !data.access_token || typeof data.expires_in !== 'number')
            throw new MailError(502, 'Google did not accept the sign-in. Check the app registration and try again.');
        if (!data.refresh_token)
            throw new MailError(
                502,
                'Google did not allow offline access. Remove this app from your Google account permissions and connect again.',
            );
        const granted = (data.scope ?? '').split(' ');
        if (required.some(scope => !granted.includes(scope)))
            throw new MailError(400, 'Allow every requested Gmail permission (read, manage and send) to connect this account.');
        const response = await request('https://openidconnect.googleapis.com/v1/userinfo', {
            headers: { Authorization: `Bearer ${data.access_token}` },
            signal: AbortSignal.timeout(30_000),
            redirect: 'error',
        });
        if (!response.ok) throw new MailError(502, 'Could not read the Google account profile.');
        const profile = (await response.json()) as { email?: string; name?: string };
        const email = (profile.email ?? '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new MailError(502, 'Google did not return an email address for this account.');
        const stored: Stored = {
            refreshToken: data.refresh_token,
            accessToken: data.access_token,
            expiresAt: now() + data.expires_in * 1000,
        };
        return { email, displayName: profile.name?.trim() ?? '', credentials: JSON.stringify(stored) };
    }

    async function accessToken(accountId: string): Promise<string> {
        return store.withCredentials(accountId, async (current, save) => {
            if (!current) throw reconnect();
            const stored = JSON.parse(current) as Stored;
            if (stored.expiresAt - 60_000 > now()) return stored.accessToken;
            let result: Awaited<ReturnType<typeof token>>;
            try {
                result = await token({ grant_type: 'refresh_token', refresh_token: stored.refreshToken });
            } catch {
                throw new MailError(502, 'Could not reach Google to renew the sign-in. Try again shortly.');
            }
            // invalid_grant: the person revoked access or the refresh token expired.
            if (result.status === 400 || result.status === 401) throw reconnect();
            if (result.status !== 200 || !result.data.access_token || typeof result.data.expires_in !== 'number')
                throw new MailError(502, 'Google could not renew the sign-in. Try again shortly.');
            await save(
                JSON.stringify({
                    refreshToken: result.data.refresh_token ?? stored.refreshToken,
                    accessToken: result.data.access_token,
                    expiresAt: now() + result.data.expires_in * 1000,
                } satisfies Stored),
            );
            return result.data.access_token;
        });
    }

    // Google counts quota per mailbox, so the budget has to outlive the short-lived clients.
    const budgets = new Map<string, QuotaBudget>();
    const budgetFor = (accountId: string) => {
        let budget = budgets.get(accountId);
        if (!budget) {
            budget = createQuotaBudget();
            budgets.set(accountId, budget);
        }
        return budget;
    };

    return {
        begin,
        complete,
        client: (accountId: string): MailClient =>
            createGmailClient(() => accessToken(accountId), request, undefined, budgetFor(accountId)),
    };
}
