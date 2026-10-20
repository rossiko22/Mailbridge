import type { Request, Response, NextFunction } from 'express';
import { MailError } from '../integrations/mail/errors.js';

export function errorMiddleware(error: unknown, _req: Request, res: Response, next: NextFunction): void {
    if (res.headersSent) {
        next(error);
        return;
    }

    if (error && typeof error === 'object' && 'type' in error) {
        if (error.type === 'entity.parse.failed' || error.type === 'entity.too.large') {
            res.status(error.type === 'entity.too.large' ? 413 : 400).json({
                message: error.type === 'entity.too.large' ? 'Request body is too large.' : 'Invalid JSON body.',
            });
            return;
        }
    }
    if (error instanceof MailError) {
        res.status(error.status).json({ message: error.message });
        return;
    }
    if (
        error instanceof Error &&
        (error.message === 'User already exists' ||
            ('code' in error && error.code === '23505' && 'constraint' in error && error.constraint === 'users_email_unique'))
    ) {
        res.status(409).json({ message: 'An account with this email already exists.' });
        return;
    }
    console.error(
        JSON.stringify({
            event: 'request-error',
            requestId: res.locals.requestId,
            name: error instanceof Error ? error.name : 'Unknown error',
            code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
        }),
    );

    res.status(500).json({
        message: 'An unexpected server error occurred',
    });
}
