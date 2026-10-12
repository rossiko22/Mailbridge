import type { RequestHandler } from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

export const securityHeaders: RequestHandler = (req, res, next) => {
    const requestId = randomUUID();
    res.set('X-Request-ID', requestId);
    res.locals.requestId = requestId;
    if (process.env.NODE_ENV === 'production' && req.path !== '/health') {
        const started = Date.now();
        res.once('finish', () => console.log(JSON.stringify({ event: 'request', requestId, method: req.method,
            path: req.path, status: res.statusCode, durationMs: Date.now() - started })));
    }
    res.set({
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
        'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        'Cache-Control': 'no-store',
    });
    if (process.env.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000');
    next();
};

export function loginThrottle(pool: Pool, secret: string): RequestHandler {
    return async (req, res, next) => {
        try {
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase().slice(0, 254) : '';
            const identities = [`ip:${req.ip}`, `account:${email}`];
            for (let i = 0; i < identities.length; i++) {
                const key = createHmac('sha256', secret).update(identities[i]!).digest('hex');
                const result = await pool.query(`INSERT INTO login_attempts(key,attempts,window_start) VALUES ($1,1,NOW())
                    ON CONFLICT (key) DO UPDATE SET
                    attempts=CASE WHEN login_attempts.window_start < NOW()-INTERVAL '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,
                    window_start=CASE WHEN login_attempts.window_start < NOW()-INTERVAL '15 minutes' THEN NOW() ELSE login_attempts.window_start END
                    RETURNING attempts`, [key]);
                if (result.rows[0].attempts > (i === 0 ? 50 : 10)) {
                    res.set('Retry-After','900').status(429).json({ message: 'Too many sign-in attempts. Wait 15 minutes and try again.' }); return;
                }
            }
            await pool.query("DELETE FROM login_attempts WHERE window_start < NOW()-INTERVAL '1 day'");
            next();
        } catch (error) { next(error); }
    };
}
