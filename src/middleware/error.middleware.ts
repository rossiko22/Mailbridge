import type { NextFunction, Request, Response } from 'express';
import { AppError, sendError } from '../http/errors.js';

const isUniqueViolation = (error: unknown, constraint: string) =>
    error instanceof Error && 'code' in error && error.code === '23505' && 'constraint' in error && error.constraint === constraint;

// Turns every thrown error into {"error":{"code","message"}}. Only AppError messages reach the client;
// anything else is logged by name and request ID and answered with a generic 500.
export function errorMiddleware(error: unknown, _req: Request, res: Response, next: NextFunction): void {
    if (res.headersSent) {
        next(error);
        return;
    }
    if (error && typeof error === 'object' && 'type' in error) {
        if (error.type === 'entity.too.large') {
            sendError(res, 413, 'body_too_large', 'Request body is too large.');
            return;
        }
        if (error.type === 'entity.parse.failed') {
            sendError(res, 400, 'invalid_json', 'Invalid JSON body.');
            return;
        }
    }
    if (error instanceof AppError) {
        sendError(res, error.status, error.code, error.message, error.details);
        return;
    }
    // Two sign-ups for the same address at the same moment both pass the service check; the unique index decides.
    if (isUniqueViolation(error, 'users_email_unique')) {
        sendError(res, 409, 'email_taken', 'An account with this email already exists.');
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
    sendError(res, 500, 'internal_error', 'An unexpected server error occurred.');
}

// Unknown paths answer in the same JSON shape instead of Express' HTML page.
export function notFoundMiddleware(_req: Request, res: Response): void {
    sendError(res, 404, 'not_found', 'Not found.');
}
