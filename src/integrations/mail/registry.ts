import { createGmailProvider, type GmailConfig } from '../gmail/provider.js';
import { createOutlookProvider, type OutlookConfig } from '../outlook/provider.js';
import { MailError } from './errors.js';
import type { CredentialStore, MailClient, MailProvider, ProviderId } from './types.js';

export interface RegistryOptions {
    outlook?: OutlookConfig | undefined;
    gmail?: GmailConfig | undefined;
    store: CredentialStore;
    request?: typeof fetch;
}

// Looks up the provider implementation for an account. Providers without app credentials are simply absent.
export function createMailRegistry(options: RegistryOptions) {
    const request = options.request ?? fetch;
    const providers: Partial<Record<ProviderId, MailProvider>> = {
        ...(options.outlook ? { outlook: createOutlookProvider(options.outlook, options.store, request) } : {}),
        ...(options.gmail ? { gmail: createGmailProvider(options.gmail, options.store, request) } : {}),
    };
    return {
        available: (): Record<ProviderId, boolean> => ({ outlook: Boolean(providers.outlook), gmail: Boolean(providers.gmail) }),
        provider: (id: ProviderId) => providers[id],
        client(account: { id: string; provider: ProviderId }): MailClient {
            const provider = providers[account.provider];
            if (!provider) throw new MailError(503, `${account.provider === 'gmail' ? 'Gmail' : 'Outlook'} is not configured on this server.`);
            return provider.client(account.id);
        },
    };
}
export type MailRegistry = ReturnType<typeof createMailRegistry>;
