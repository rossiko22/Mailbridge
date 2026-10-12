import type { RequestHandler } from 'express';

export const requireSameSiteJson: RequestHandler = (req, res, next) => {
    const expectedOrigin = process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        (!req.is('application/json') || req.get('Sec-Fetch-Site') === 'cross-site' || (req.get('origin') && req.get('origin') !== expectedOrigin))) {
        res.status(415).json({ message: 'Use a same-site application/json request.' });
        return;
    }
    next();
};
