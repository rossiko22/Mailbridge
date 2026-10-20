import type { RequestHandler } from 'express';
import { sendError } from '../http/errors.js';

// Blocks cross-site request forgery: a state-changing request must be JSON (which a plain HTML form cannot send),
// must not be marked cross-site by the browser, and must come from our own origin when it names one.
// `expectedOrigin` is null only outside production, where the host the request was sent to is used instead.
export function createRequireSameSiteJson(expectedOrigin: string | null): RequestHandler {
    return (req, res, next) => {
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
            next();
            return;
        }
        const origin = expectedOrigin ?? `${req.protocol}://${req.get('host')}`;
        const sentOrigin = req.get('origin');
        if (!req.is('application/json') || req.get('Sec-Fetch-Site') === 'cross-site' || (sentOrigin && sentOrigin !== origin)) {
            sendError(res, 415, 'unsupported_request', 'Use a same-site application/json request.');
            return;
        }
        next();
    };
}
