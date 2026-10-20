import { Router, type Request } from 'express';
import type { createAuthMiddleware } from '../../middleware/auth.middleware.js';
import { MailError } from '../../integrations/mail/errors.js';
import type { EmailService } from './emails.service.js';
import { defaultFilters, type MailFilters } from './emails.types.js';
import { emailCsp, renderEmail } from './presentation.js';
import { noAudit, type Audit } from '../audit/audit.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const address = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
const addresses = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every(item => typeof item === 'string' && item.length <= 254 && address.test(item));

export function createEmailRouter(auth: ReturnType<typeof createAuthMiddleware>, service: EmailService, audit: Audit = noAudit) {
    const router = Router();
    router.use(auth.requireAuth);
    router.use((_req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    const me = (req: { currentUser?: { userId: string } }) => req.currentUser!.userId;
    // Records who sent what kind of message and to how many people, never the text or the addresses.
    async function audited<T>(req: Request, action: string, target: string, recipients: number, send: () => Promise<T>): Promise<T> {
        try {
            const result = await send();
            await audit.record(req, 'mail-send', 'success', { target, detail: { action, recipients } });
            return result;
        } catch (error) {
            await audit.record(req, 'mail-send', 'failure', {
                target,
                detail: { action, recipients, status: error instanceof MailError ? error.status : 500 },
            });
            throw error;
        }
    }

    router.get('/', async (req, res) => {
        const q = req.query;
        const offset = Number(q.offset ?? 0);
        const sort = q.sort ?? 'newest';
        if (
            !Number.isSafeInteger(offset) ||
            offset < 0 ||
            offset > 1_000_000 ||
            (sort !== 'newest' && sort !== 'oldest') ||
            (q.search !== undefined && (typeof q.search !== 'string' || q.search.length > 200)) ||
            (q.account !== undefined && (typeof q.account !== 'string' || !uuid.test(q.account))) ||
            (q.unread !== undefined && q.unread !== 'true' && q.unread !== 'false')
        ) {
            throw new MailError(400, 'Invalid mailbox filters.');
        }
        const filters: MailFilters = {
            ...defaultFilters,
            offset,
            sort,
            search: String(q.search ?? '').trim(),
            accountId: typeof q.account === 'string' ? q.account : null,
            unreadOnly: q.unread === 'true',
        };
        res.json(await service.list(me(req), filters));
    });

    router.post('/compose', async (req, res) => {
        const { accountId, requestId, subject, body, to, cc = [], bcc = [] } = req.body ?? {};
        if (
            typeof accountId !== 'string' ||
            !uuid.test(accountId) ||
            typeof requestId !== 'string' ||
            !uuid.test(requestId) ||
            typeof subject !== 'string' ||
            !subject.trim() ||
            subject.length > 250 ||
            /[\r\n]/.test(subject) ||
            typeof body !== 'string' ||
            !body.trim() ||
            body.length > 20000 ||
            !addresses(to) ||
            !to.length ||
            !addresses(cc) ||
            !addresses(bcc) ||
            to.length + cc.length + bcc.length > 20
        ) {
            throw new MailError(400, 'Choose an account, then enter a subject, a message and valid recipient addresses (maximum 20).');
        }
        res.status(202).json(
            await audited(req, 'compose', accountId, to.length + cc.length + bcc.length, () =>
                service.compose(me(req), accountId, requestId, { subject, body, to, cc, bcc }),
            ),
        );
    });

    router.param('id', (_req, _res, next, id) => {
        next(uuid.test(id) ? undefined : new MailError(400, 'Invalid email ID.'));
    });

    router.get('/:id', async (req, res) => {
        res.json({ email: await service.get(me(req), String(req.params.id)) });
    });

    router.patch('/:id/read', async (req, res) => {
        if (typeof req.body?.isRead !== 'boolean') throw new MailError(400, 'isRead must be true or false.');
        res.json(await service.setRead(me(req), String(req.params.id), req.body.isRead));
    });

    router.get('/:id/body', async (req, res) => {
        if (req.query.images !== undefined && req.query.images !== 'true') throw new MailError(400, 'images must be true or omitted.');
        const body = await service.body(me(req), String(req.params.id));
        const images = req.query.images === 'true';
        // The header value is a constant (only our own reader may frame the message), not user input.
        // nosemgrep: javascript.express.security.x-frame-options-misconfiguration.x-frame-options-misconfiguration
        res.set({ 'Content-Security-Policy': emailCsp(images), 'X-Frame-Options': 'SAMEORIGIN' })
            .type('html')
            .send(renderEmail(body, images));
    });

    router.get('/:id/export', async (req, res) => {
        if (req.query.original !== undefined && req.query.original !== 'true')
            throw new MailError(400, 'original must be true or omitted.');
        const original = req.query.original === 'true';
        const data = await service.exportEmail(me(req), String(req.params.id), original);
        await audit.record(req, 'mail-export', 'success', { target: String(req.params.id), detail: { original } });
        res.attachment(`mail-${req.params.id}${original ? '-original' : '-text'}.eml`)
            .type('message/rfc822')
            .send(data);
    });

    router.get('/:id/attachments', async (req, res) => {
        res.json({ attachments: await service.attachments(me(req), String(req.params.id)) });
    });

    router.get('/:id/attachments/:attachmentId', async (req, res) => {
        const attachmentId = String(req.params.attachmentId);
        if (attachmentId.length > 2048 || /[\r\n\x00]/.test(attachmentId)) throw new MailError(400, 'Invalid attachment ID.');
        const result = await service.attachment(me(req), String(req.params.id), attachmentId);
        await audit.record(req, 'attachment-download', 'success', { target: String(req.params.id) });
        const filename = result.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200) || 'attachment';
        res.set('X-Content-Type-Options', 'nosniff').attachment(filename).type('application/octet-stream').send(result.data);
    });

    router.post('/:id/send', async (req, res) => {
        const { action, requestId, comment, recipients = [] } = req.body ?? {};
        if (
            (action !== 'reply' && action !== 'forward') ||
            typeof requestId !== 'string' ||
            !uuid.test(requestId) ||
            typeof comment !== 'string' ||
            comment.length > 20000 ||
            (action === 'reply' && !comment.trim()) ||
            !addresses(recipients) ||
            recipients.length > 20 ||
            (action === 'forward' && !recipients.length) ||
            (action === 'reply' && recipients.length)
        ) {
            throw new MailError(400, 'Enter a message and valid recipient email addresses (maximum 20).');
        }
        res.status(202).json(
            await audited(req, action, String(req.params.id), recipients.length, () =>
                service.reply(me(req), String(req.params.id), requestId, action, comment, recipients),
            ),
        );
    });

    return router;
}
