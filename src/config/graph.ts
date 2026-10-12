import 'dotenv/config';
import type { OutlookConfig } from '../integrations/outlook/graph.js';

export function graphConfig(settings: NodeJS.ProcessEnv = process.env): OutlookConfig | undefined {
    const mode = settings.GRAPH_AUTH_MODE?.trim() || (settings.GRAPH_ACCESS_TOKEN?.trim() ? 'access_token' : 'application');
    if (mode === 'disabled') return undefined;
    if (mode === 'oauth') {
        const keys = ['GRAPH_TENANT_ID','GRAPH_CLIENT_ID','GRAPH_CLIENT_SECRET','GRAPH_MAILBOX','GRAPH_OWNER_EMAIL','GRAPH_REDIRECT_URI'] as const;
        const values = keys.map(key => settings[key]?.trim());
        if (values.some(value => !value)) throw new Error(`OAuth mode requires ${keys.join(', ')}`);
        const redirect = new URL(values[5]!);
        if (redirect.pathname !== '/emails/connection/callback' || redirect.search || redirect.hash || redirect.username || redirect.password ||
            (redirect.protocol !== 'https:' && !(settings.NODE_ENV !== 'production' && redirect.protocol === 'http:' && ['localhost','127.0.0.1'].includes(redirect.hostname)))) throw new Error('GRAPH_REDIRECT_URI must be an HTTPS /emails/connection/callback URL (HTTP localhost is allowed for development)');
        if (settings.NODE_ENV === 'production' && redirect.origin !== settings.PUBLIC_ORIGIN) throw new Error('GRAPH_REDIRECT_URI must use PUBLIC_ORIGIN');
        return { authMode: 'oauth', tenantId: values[0]!, clientId: values[1]!, clientSecret: values[2]!, mailbox: values[3]!.toLowerCase(), ownerEmail: values[4]!.toLowerCase(), redirectUri: redirect.href };
    }
    if (mode !== 'application' && mode !== 'access_token') throw new Error('GRAPH_AUTH_MODE must be application, oauth, access_token or disabled');
    if (mode === 'access_token') {
        const accessToken = settings.GRAPH_ACCESS_TOKEN?.trim();
        const mailbox = settings.GRAPH_MAILBOX?.trim().toLowerCase();
        const ownerEmail = settings.GRAPH_OWNER_EMAIL?.trim().toLowerCase();
        if (!accessToken || !mailbox || !ownerEmail) {
            throw new Error('Access-token mode requires GRAPH_ACCESS_TOKEN, GRAPH_MAILBOX and GRAPH_OWNER_EMAIL (your ticketing app login email).');
        }
        if (/\s/.test(accessToken)) throw new Error('GRAPH_ACCESS_TOKEN must contain only the token, without the Bearer prefix.');
        return { authMode: 'access_token', accessToken, mailbox, ownerEmail };
    }
    const keys = ['GRAPH_TENANT_ID', 'GRAPH_CLIENT_ID', 'GRAPH_CLIENT_SECRET', 'GRAPH_MAILBOX'] as const;
    const values = keys.map(key => settings[key]?.trim());
    if (values.every(value => !value) && settings.NODE_ENV !== 'production') return undefined;
    if (values.some(value => !value)) throw new Error(`Configure all of: ${keys.join(', ')}`);
    return { tenantId: values[0]!, clientId: values[1]!, clientSecret: values[2]!, mailbox: values[3]!.toLowerCase() };
}
