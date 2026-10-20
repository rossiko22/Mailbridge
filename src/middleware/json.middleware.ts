import type { RequestHandler } from 'express';
import { sendError } from '../http/errors.js';

export const requireSameSiteJson: RequestHandler = (req, res, next) => {
    const expectedOrigin = process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
    if (
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        (!req.is('application/json') ||
            req.get('Sec-Fetch-Site') === 'cross-site' ||
            (req.get('origin') && req.get('origin') !== expectedOrigin))
    ) {
        sendError(res, 415, 'unsupported_request', 'Use a same-site application/json request.');
        return;
    }
    next();
};
