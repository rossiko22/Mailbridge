import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import type { createAuthMiddleware } from '../../middleware/auth.middleware.js';
import type { createEmailService } from './emails.service.js';
import type { createOutlookConnection } from '../../integrations/outlook/connection.js';
import { GraphError } from '../../integrations/outlook/graph.js';
import type { MailAccess, MailFilters } from './emails.types.js';
import { emailCsp, renderEmail } from './presentation.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function createEmailRouter(auth: ReturnType<typeof createAuthMiddleware>, service?: ReturnType<typeof createEmailService>, ownerEmail?: string, connection?: ReturnType<typeof createOutlookConnection>) {
    const router = Router();
    const access = (req: Request): MailAccess => ({ userId: req.currentUser!.userId,
        manage: !ownerEmail || req.currentUser!.email.toLowerCase() === ownerEmail.toLowerCase() });
    router.use(auth.requireAuth);
    router.use((req, res, next) => {
        res.set('Cache-Control', 'no-store');
        if (!service) { res.status(503).json({ message: 'Outlook is not configured. Add the GRAPH_* settings to the server environment.' }); return; }
        if (!['GET','HEAD'].includes(req.method) && (!req.is('application/json') || req.get('Sec-Fetch-Site') === 'cross-site')) {
            res.status(415).json({ message: 'Use a same-site application/json request.' }); return;
        }
        next();
    });
    function manager(req: Request) {
        if (!access(req).manage) throw new GraphError(403, 'Only the mailbox owner can manage its connection or sync mail.');
    }
    router.get('/meta', async (req, res) => {
        const scope = access(req);
        res.json({ ...await service!.metadata(scope), canManage: scope.manage, currentUser: req.currentUser });
    });
    router.get('/connection', async (req, res) => {
        manager(req);
        if (!connection) throw new GraphError(503, 'Outlook settings unavailable.');
        res.json(await connection.status());
    });
    router.get('/connection/authorize', async (req, res) => {
        manager(req);
        if (!connection?.beginOAuth) throw new GraphError(400, 'Microsoft sign-in requires GRAPH_AUTH_MODE=oauth.');
        const result = await connection.beginOAuth();
        req.session.outlookOAuth = result.pending;
        await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
        res.redirect(result.url);
    });
    router.get('/connection/callback', async (req, res) => {
        manager(req);
        const pending = req.session.outlookOAuth;
        delete req.session.outlookOAuth;
        await new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
        if (!pending || pending.expiresAt < Date.now() || typeof req.query.state !== 'string' || req.query.state !== pending.state) {
            res.redirect('/settings.html?outlook=invalid-state'); return;
        }
        if (typeof req.query.code !== 'string' || !connection?.completeOAuth) { res.redirect('/settings.html?outlook=denied'); return; }
        try { await connection.completeOAuth(req.query.code, pending); res.redirect('/settings.html?outlook=connected'); }
        catch { res.redirect('/settings.html?outlook=failed'); }
    });
    router.put('/connection/token', async (req, res) => {
        manager(req);
        if (!connection) throw new GraphError(503, 'Outlook settings unavailable.');
        if (typeof req.body?.token !== 'string') throw new GraphError(400, 'An access token is required.');
        await connection.saveToken(req.body.token.trim());
        res.json({ message: 'Token verified and saved. You can sync now; no restart is needed.' });
    });
    router.get('/', async (req, res) => {
        const q = req.query;
        const offset = Number(q.offset ?? 0);
        const status = q.status ?? 'all'; const view = q.view ?? 'all'; const sort = q.sort ?? 'newest';
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000 ||
            typeof status !== 'string' || !['all','unassigned','progress','finished'].includes(status) || typeof view !== 'string' || !['all','assigned','mine'].includes(view) ||
            typeof sort !== 'string' || !['newest','oldest'].includes(sort) || (q.search !== undefined && (typeof q.search !== 'string' || q.search.length > 200)) ||
            [q.assignee,q.closedBy].some(value => value !== undefined && (typeof value !== 'string' || !uuid.test(value)))) {
            throw new GraphError(400, 'Invalid mailbox filters.');
        }
        const filters: MailFilters = { offset, status: status as MailFilters['status'], view: view as MailFilters['view'], sort: sort as MailFilters['sort'],
            search: String(q.search ?? ''), assignee: q.assignee ? String(q.assignee) : null, closedBy: q.closedBy ? String(q.closedBy) : null };
        res.json(await service!.list(offset, filters, access(req)));
    });
    router.post('/sync', async (req, res) => { manager(req); res.json(await service!.sync()); });
    router.get('/outgoing', async (req, res) => { res.json({ messages: await service!.outgoing(access(req)) }); });
    router.post('/compose', async (req, res) => {
        manager(req);
        const { requestId, subject, body, to, cc = [], bcc = [] } = req.body ?? {};
        const validAddresses = (value: unknown): value is string[] => Array.isArray(value) && value.every(item =>
            typeof item === 'string' && item.length <= 254 && /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(item));
        if (typeof requestId !== 'string' || !uuid.test(requestId) || typeof subject !== 'string' || !subject.trim() || subject.length > 250 || /[\r\n]/.test(subject) ||
            typeof body !== 'string' || !body.trim() || body.length > 20000 || !validAddresses(to) || !to.length ||
            !validAddresses(cc) || !validAddresses(bcc) || to.length + cc.length + bcc.length > 20) throw new GraphError(400, 'Enter a subject, message and valid recipient addresses (maximum 20).');
        res.status(202).json(await service!.compose(access(req), requestId, { subject, body, to, cc, bcc }));
    });
    router.param('id', (_req, _res, next, id) => { next(uuid.test(id) ? undefined : new GraphError(400, 'Invalid email ID.')); });
    router.get('/:id/body', async (req, res) => {
        if (req.query.images !== undefined && req.query.images !== 'true') throw new GraphError(400, 'images must be true or omitted.');
        const body = await service!.body(String(req.params.id), access(req));
        const images = req.query.images === 'true';
        res.set({ 'Content-Security-Policy': emailCsp(images), 'X-Frame-Options': 'SAMEORIGIN' })
            .type('html').send(renderEmail(body, images));
    });
    router.get('/:id/export', async (req, res) => {
        if (req.query.original !== undefined && req.query.original !== 'true') throw new GraphError(400, 'original must be true or omitted.');
        const data = await service!.exportEmail(String(req.params.id), access(req), req.query.original === 'true');
        res.attachment(`ticket-${req.params.id}${req.query.original ? '-original' : '-text'}.eml`).type('message/rfc822').send(data);
    });
    router.get('/:id/attachments', async (req, res) => { res.json({ attachments: await service!.attachments(String(req.params.id), access(req)) }); });
    router.get('/:id/attachments/:attachmentId', async (req, res) => {
        const attachmentId = String(req.params.attachmentId);
        if (attachmentId.length > 2048 || /[\r\n\x00]/.test(attachmentId)) throw new GraphError(400, 'Invalid attachment ID.');
        const result = await service!.attachment(String(req.params.id), attachmentId, access(req));
        const filename = result.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200) || 'attachment';
        res.set('X-Content-Type-Options', 'nosniff').attachment(filename).type('application/octet-stream').send(result.data);
    });
    router.get('/:id', async (req, res) => {
        const email = await service!.get(String(req.params.id), access(req));
        if (!email) throw new GraphError(404, 'Email not found.');
        const { graphId, ...safe } = email;
        res.json({ email: safe });
    });
    router.patch('/:id/ticket', async (req, res) => {
        const { action, version, assignee } = req.body ?? {};
        if (!['assign','finish','reopen'].includes(action) || !Number.isSafeInteger(version) || version < 0 ||
            (action === 'assign' && assignee !== null && (typeof assignee !== 'string' || !uuid.test(assignee)))) {
            throw new GraphError(400, 'Provide a valid ticket action, version and assignee.');
        }
        await service!.transition(String(req.params.id), access(req), version, action, assignee);
        res.json({ updated: true });
    });
    router.post('/:id/send', async (req, res) => {
        const { action, requestId, comment, recipients = [] } = req.body ?? {};
        if (!['reply','forward'].includes(action) || typeof requestId !== 'string' || !uuid.test(requestId) ||
            typeof comment !== 'string' || comment.length > 20000 || (action === 'reply' && !comment.trim()) ||
            !Array.isArray(recipients) || recipients.length > 20 || (action === 'forward' && !recipients.length) ||
            (action === 'reply' && recipients.length) || recipients.some(value => typeof value !== 'string' || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(value))) {
            throw new GraphError(400, 'Enter a message and valid recipient email addresses (maximum 20).');
        }
        res.status(202).json(await service!.send(String(req.params.id), access(req), requestId, action, comment, recipients));
    });
    router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
        if (error instanceof GraphError) { res.status(error.status).json({ message: error.message }); return; }
        next(error);
    });
    return router;
}
