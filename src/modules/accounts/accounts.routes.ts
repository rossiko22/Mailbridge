import { Router } from 'express';
import type { Request, Response } from 'express';
import type { createAuthMiddleware } from '../../middleware/auth.middleware.js';
import { MailError } from '../../integrations/mail/errors.js';
import type { MailRegistry } from '../../integrations/mail/registry.js';
import { providerIds, type ProviderId } from '../../integrations/mail/types.js';
import type { EmailService } from '../emails/emails.service.js';
import type { createAccountsRepository } from './accounts.repository.js';
import { noAudit, type Audit } from '../audit/audit.js';

type AccountsRepository = ReturnType<typeof createAccountsRepository>;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const saveSession = (req: Request) => new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
const providerOf = (value: unknown): ProviderId | undefined => providerIds.find(id => id === value);

// Where the person lands after the provider sends them back. The app shows the outcome in a notice.
const back = (code: string, extra: Record<string, string> = {}) => `/app.html?${new URLSearchParams({ connect: code, ...extra })}`;

// Which sign-in emails may connect Gmail. An empty list means everyone.
export const mayUseProvider = (allowedGmail: readonly string[], provider: ProviderId, email: string) =>
    provider !== 'gmail' || allowedGmail.length === 0 || allowedGmail.includes(email.trim().toLowerCase());

export function createAccountsRouter(auth: ReturnType<typeof createAuthMiddleware>, accounts: AccountsRepository, registry: MailRegistry, emails: EmailService, allowedGmail: readonly string[] = [], audit: Audit = noAudit) {
    const router = Router();

    // The two browser-navigation routes send signed-out visitors to the sign-in page instead of showing JSON.
    const signedInPage = (req: Request, res: Response, next: (error?: unknown) => void) => {
        if (!req.session.userId) { res.redirect('/index.html'); return; }
        auth.requireAuth(req, res, next);
    };

    router.get('/connect/:provider', signedInPage, async (req, res) => {
        const id = providerOf(req.params.provider);
        const provider = id && mayUseProvider(allowedGmail, id, req.currentUser!.email) ? registry.provider(id) : undefined;
        if (!provider) { res.redirect(back('unavailable')); return; }
        const { url, pending } = await provider.begin();
        req.session.mailOAuth = pending;
        await saveSession(req);
        res.redirect(url);
    });

    router.get('/callback/:provider', signedInPage, async (req, res) => {
        const id = providerOf(req.params.provider);
        const provider = id && mayUseProvider(allowedGmail, id, req.currentUser!.email) ? registry.provider(id) : undefined;
        const pending = req.session.mailOAuth;
        delete req.session.mailOAuth;
        await saveSession(req);
        if (!id || !provider) { res.redirect(back('unavailable')); return; }
        if (!pending || pending.provider !== id || pending.expiresAt < Date.now() || typeof req.query.state !== 'string' || req.query.state !== pending.state) {
            await audit.record(req, 'account-connect', 'denied', { detail: { provider: id, reason: 'invalid-state' } });
            res.redirect(back('invalid-state')); return;
        }
        if (typeof req.query.code !== 'string') {
            await audit.record(req, 'account-connect', 'failure', { detail: { provider: id, reason: 'declined' } });
            res.redirect(back('denied')); return;
        }
        try {
            const profile = await provider.complete(req.query.code, pending);
            const saved = await accounts.upsertConnected(req.currentUser!.userId, id, profile.email, profile.displayName, profile.credentials);
            await audit.record(req, 'account-connect', 'success', { target: saved.id, detail: { provider: id, email: profile.email, renewed: !saved.created } });
            res.redirect(back(saved.created ? 'ok' : 'renewed', { account: saved.id }));
        } catch (error) {
            await audit.record(req, 'account-connect', 'failure', { detail: { provider: id, reason: 'provider-error' } });
            // The reason waits in the session: text taken from a URL could be written by anyone who crafts a link.
            if (error instanceof MailError) { req.session.connectNotice = error.message; await saveSession(req); }
            else console.error(JSON.stringify({ event: 'account-connect-error', provider: id, name: error instanceof Error ? error.name : 'Unknown' }));
            res.redirect(back('failed'));
        }
    });

    router.use(auth.requireAuth);
    router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

    router.get('/', async (req, res) => {
        // A provider this person may not use is left out entirely, so the UI never offers it.
        const providers: Partial<Record<ProviderId, boolean>> = registry.available();
        for (const id of providerIds) if (!mayUseProvider(allowedGmail, id, req.currentUser!.email)) delete providers[id];
        const notice = req.session.connectNotice;
        if (notice) { delete req.session.connectNotice; await saveSession(req); }
        res.json({ accounts: await accounts.list(req.currentUser!.userId), providers, ...(notice ? { notice } : {}) });
    });

    router.param('id', (_req, _res, next, id) => { next(uuid.test(id) ? undefined : new MailError(400, 'Invalid account ID.')); });

    router.post('/:id/sync', async (req, res) => {
        res.json(await emails.sync(req.currentUser!.userId, String(req.params.id)));
    });

    router.delete('/:id', async (req, res) => {
        const account = await accounts.get(req.currentUser!.userId, String(req.params.id));
        if (!account || !await accounts.remove(req.currentUser!.userId, account.id)) throw new MailError(404, 'Account not found.');
        await audit.record(req, 'account-remove', 'success', { target: account.id, detail: { provider: account.provider, email: account.email } });
        res.json({ removed: true });
    });

    return router;
}
