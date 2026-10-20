import type { RequestHandler } from 'express';
import { createHmac } from 'node:crypto';
import type { Pool } from 'pg';
import { sendError } from '../http/errors.js';

// The security headers every response carries. Request IDs and request logs come from the request logger.
export const createSecurityHeaders =
    ({ production }: { production: boolean }): RequestHandler =>
    (_req, res, next) => {
        res.set({
            'Content-Security-Policy':
                "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'no-referrer',
            'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Resource-Policy': 'same-origin',
            'X-Permitted-Cross-Domain-Policies': 'none',
            'Cache-Control': 'no-store',
        });
        if (production) res.set('Strict-Transport-Security', 'max-age=31536000');
        next();
    };

export interface ThrottleLimits {
    perIp?: number;
    perAccount?: number;
    perUser?: number;
}

// Counts attempts per client address, per account when the body carries an email, and per signed-in user.
// Keys are hashed so the table never stores addresses. Each scope keeps its own counters.
// Shared by every throttle in this process.
let lastPrune = 0;

export function throttle(
    pool: Pool,
    secret: string,
    scope: string,
    limits: ThrottleLimits,
    message = 'Too many attempts. Wait 15 minutes and try again.',
): RequestHandler {
    return async (req, res, next) => {
        try {
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
            const userId = (req.session as typeof req.session | undefined)?.userId;
            const identities: Array<[string, number]> = [];
            if (limits.perIp !== undefined) identities.push([`${scope}:ip:${req.ip}`, limits.perIp]);
            if (limits.perAccount !== undefined) identities.push([`${scope}:account:${email}`, limits.perAccount]);
            if (limits.perUser !== undefined && userId) identities.push([`${scope}:user:${userId}`, limits.perUser]);
            for (const [identity, limit] of identities) {
                const key = createHmac('sha256', secret).update(identity).digest('hex');
                const result = await pool.query(
                    `INSERT INTO login_attempts(key,attempts,window_start) VALUES ($1,1,NOW())
                    ON CONFLICT (key) DO UPDATE SET
                    attempts=CASE WHEN login_attempts.window_start < NOW()-INTERVAL '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,
                    window_start=CASE WHEN login_attempts.window_start < NOW()-INTERVAL '15 minutes' THEN NOW() ELSE login_attempts.window_start END
                    RETURNING attempts`,
                    [key],
                );
                if (result.rows[0].attempts > limit) {
                    res.locals.throttled = true;
                    res.set('Retry-After', '900');
                    sendError(res, 429, 'rate_limited', message);
                    return;
                }
            }
            // Old counters are removed at most once a minute, not on every request.
            if (Date.now() - lastPrune > 60_000) {
                lastPrune = Date.now();
                await pool.query("DELETE FROM login_attempts WHERE window_start < NOW()-INTERVAL '1 day'");
            }
            next();
        } catch (error) {
            next(error);
        }
    };
}
