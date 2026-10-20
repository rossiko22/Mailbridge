import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import type { Pool } from 'pg';

const PostgresSessionStore = connectPgSimple(session);

export interface SessionCookie {
    name: string;
    secure: boolean;
}

// In production the cookie carries the __Host- prefix: browsers then only accept it over HTTPS, from this exact
// host, for the whole site, and never with a Domain attribute, so a sibling subdomain cannot plant or override it.
// Plain HTTP in development cannot use the prefix.
export const sessionCookie = (production: boolean): SessionCookie =>
    production ? { name: '__Host-session', secure: true } : { name: 'session', secure: false };

export function createSessionMiddleware(pool: Pool, options: { secret: string; cookie: SessionCookie }) {
    return session({
        name: options.cookie.name,
        secret: options.secret,
        store: new PostgresSessionStore({
            pool,
            tableName: 'sessions',
            createTableIfMissing: false,
        }),
        resave: false,
        saveUninitialized: false,
        rolling: true,
        cookie: {
            httpOnly: true,
            secure: options.cookie.secure,
            sameSite: 'lax',
            maxAge: 8 * 60 * 60 * 1000,
            path: '/',
        },
    });
}
