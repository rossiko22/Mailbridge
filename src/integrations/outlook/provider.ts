import { type AuthenticationResult, ConfidentialClientApplication, InteractionRequiredAuthError } from '@azure/msal-node';
import { createHash, randomBytes } from 'node:crypto';
import { MailError } from '../mail/errors.js';
import type { ConnectedProfile, CredentialStore, MailClient, MailProvider, PendingAuth } from '../mail/types.js';
import { createGraphClient } from './graph.js';

export const outlookScopes = ['https://graph.microsoft.com/User.Read', 'https://graph.microsoft.com/Mail.ReadWrite', 'https://graph.microsoft.com/Mail.Send', 'offline_access'];

export interface OutlookConfig { clientId: string; clientSecret: string; tenant: string; redirectUri: string }

const makeMsal = (config: OutlookConfig) => new ConfidentialClientApplication({
    auth: { clientId: config.clientId, clientSecret: config.clientSecret, authority: `https://login.microsoftonline.com/${encodeURIComponent(config.tenant)}` },
    system: { loggerOptions: { piiLoggingEnabled: false, loggerCallback: () => {} } },
});

interface Stored { cache: string; homeAccountId: string }
const reconnect = () => new MailError(502, 'Microsoft sign-in expired for this account. Reconnect it in Settings.', true);

export function createOutlookProvider(config: OutlookConfig, store: CredentialStore, request: typeof fetch = fetch,
    factory: (config: OutlookConfig) => ConfidentialClientApplication = makeMsal): MailProvider {

    async function begin() {
        const state = randomBytes(32).toString('base64url');
        const verifier = randomBytes(48).toString('base64url');
        const url = await factory(config).getAuthCodeUrl({
            scopes: outlookScopes, redirectUri: config.redirectUri, state, prompt: 'select_account',
            codeChallenge: createHash('sha256').update(verifier).digest('base64url'), codeChallengeMethod: 'S256',
        });
        const pending: PendingAuth = { provider: 'outlook', state, verifier, expiresAt: Date.now() + 10 * 60_000 };
        return { url, pending };
    }

    async function complete(code: string, pending: PendingAuth): Promise<ConnectedProfile> {
        const msal = factory(config);
        let result: AuthenticationResult | null;
        try { result = await msal.acquireTokenByCode({ code, codeVerifier: pending.verifier, scopes: outlookScopes, redirectUri: config.redirectUri }); }
        catch { throw new MailError(502, 'Microsoft did not accept the sign-in. Check the app registration and try again.'); }
        if (!result?.accessToken || !result.account) throw new MailError(502, 'Microsoft did not provide an account and access token.');
        const response = await request('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName,displayName', {
            headers: { Authorization: `Bearer ${result.accessToken}` }, signal: AbortSignal.timeout(30_000), redirect: 'error',
        });
        if (!response.ok) throw new MailError(502, 'Could not read the Microsoft account. Accept the User.Read permission and try again.');
        const profile = await response.json() as { mail?: string | null; userPrincipalName?: string; displayName?: string };
        const email = (profile.mail || profile.userPrincipalName || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new MailError(502, 'Microsoft did not return a mailbox address for this account.');
        const stored: Stored = { cache: msal.getTokenCache().serialize(), homeAccountId: result.account.homeAccountId };
        return { email, displayName: profile.displayName?.trim() ?? '', credentials: JSON.stringify(stored) };
    }

    async function accessToken(accountId: string): Promise<string> {
        return store.withCredentials(accountId, async (current, save) => {
            if (!current) throw reconnect();
            const stored = JSON.parse(current) as Stored;
            const msal = factory(config);
            const cache = msal.getTokenCache();
            cache.deserialize(stored.cache);
            const account = await cache.getAccountByHomeId(stored.homeAccountId);
            if (!account) throw reconnect();
            let result: AuthenticationResult | null;
            try { result = await msal.acquireTokenSilent({ account, scopes: outlookScopes }); }
            catch (error) {
                if (error instanceof InteractionRequiredAuthError) throw reconnect();
                throw new MailError(502, 'Could not reach Microsoft to renew the sign-in. Try again shortly.');
            }
            if (!result?.accessToken) throw reconnect();
            const next = cache.serialize();
            if (next !== stored.cache) await save(JSON.stringify({ cache: next, homeAccountId: stored.homeAccountId } satisfies Stored));
            return result.accessToken;
        });
    }

    return { begin, complete, client: (accountId: string): MailClient => createGraphClient(() => accessToken(accountId), request) };
}
