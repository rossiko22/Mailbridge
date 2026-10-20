import { type Request, Router } from 'express';
import { AppError } from '../../http/errors.js';
import { parse } from '../../http/validate.js';
import { MailError } from '../../integrations/mail/errors.js';
import type { createAuthMiddleware } from '../../middleware/auth.middleware.js';
import { type Audit, noAudit } from '../audit/audit.js';
import {
    attachmentParams,
    bodyQuery,
    composeBody,
    decodeCursor,
    emailIdParams,
    exportQuery,
    listQuery,
    readBody,
    sendBody,
} from './emails.schemas.js';
import type { EmailService } from './emails.service.js';
import { emailCsp, renderEmail } from './presentation.js';

export interface EmailRouterOptions {
    service: EmailService;
    requireAuth: ReturnType<typeof createAuthMiddleware>['requireAuth'];
    audit?: Audit;
}

export function createEmailRouter({ service, requireAuth, audit = noAudit }: EmailRouterOptions) {
    const router = Router();
    router.use(requireAuth);
    router.use((_req, res, next) => {
        res.set('Cache-Control', 'no-store');
        next();
    });
    const me = (req: Request) => req.currentUser!.userId;

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
        const query = parse(listQuery, req.query);
        const after = query.cursor ? decodeCursor(query.cursor) : null;
        if (query.cursor && after?.sort !== query.sort) throw new AppError(400, 'validation_failed', 'Invalid page cursor.');
        res.json(
            await service.list(me(req), {
                after,
                sort: query.sort,
                search: query.search,
                accountId: query.account ?? null,
                unreadOnly: query.unread === 'true',
            }),
        );
    });

    router.post('/compose', async (req, res) => {
        const { accountId, requestId, ...message } = parse(composeBody, req.body);
        const count = message.to.length + message.cc.length + message.bcc.length;
        res.status(202).json(
            await audited(req, 'compose', accountId, count, () => service.compose(me(req), accountId, requestId, message)),
        );
    });

    router.get('/:id', async (req, res) => {
        const { id } = parse(emailIdParams, req.params);
        res.json({ email: await service.get(me(req), id) });
    });

    router.patch('/:id/read', async (req, res) => {
        const { id } = parse(emailIdParams, req.params);
        const { isRead } = parse(readBody, req.body);
        res.json(await service.setRead(me(req), id, isRead));
    });

    router.get('/:id/body', async (req, res) => {
        const { id } = parse(emailIdParams, req.params);
        const images = parse(bodyQuery, req.query).images === 'true';
        const body = await service.body(me(req), id);
        // The header value is a constant (only our own reader may frame the message), not user input.
        // nosemgrep: javascript.express.security.x-frame-options-misconfiguration.x-frame-options-misconfiguration
        res.set({ 'Content-Security-Policy': emailCsp(images), 'X-Frame-Options': 'SAMEORIGIN' })
            .type('html')
            .send(renderEmail(body, images));
    });

    router.get('/:id/export', async (req, res) => {
        const { id } = parse(emailIdParams, req.params);
        const original = parse(exportQuery, req.query).original === 'true';
        const data = await service.exportEmail(me(req), id, original);
        await audit.record(req, 'mail-export', 'success', { target: id, detail: { original } });
        res.attachment(`mail-${id}${original ? '-original' : '-text'}.eml`)
            .type('message/rfc822')
            .send(data);
    });

    router.get('/:id/attachments', async (req, res) => {
        const { id } = parse(emailIdParams, req.params);
        res.json({ attachments: await service.attachments(me(req), id) });
    });

    router.get('/:id/attachments/:attachmentId', async (req, res) => {
        const { id, attachmentId } = parse(attachmentParams, req.params);
        const result = await service.attachment(me(req), id, attachmentId);
        await audit.record(req, 'attachment-download', 'success', { target: id });
        const filename = result.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 200) || 'attachment';
        res.set('X-Content-Type-Options', 'nosniff').attachment(filename).type('application/octet-stream').send(result.data);
    });

    router.post('/:id/send', async (req, res) => {
        const { id } = parse(emailIdParams, req.params);
        const { action, requestId, comment, recipients } = parse(sendBody, req.body);
        res.status(202).json(
            await audited(req, action, id, recipients.length, () => service.reply(me(req), id, requestId, action, comment, recipients)),
        );
    });

    return router;
}
