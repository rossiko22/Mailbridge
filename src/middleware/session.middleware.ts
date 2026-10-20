import connectPgSimple from 'connect-pg-simple';
import session from 'express-session';
import type { Pool } from 'pg';

const PostgresSessionStore = connectPgSimple(session);

export function createSessionMiddleware(pool: Pool, options: { secret: string; secure: boolean }) {
    return session({
        name: 'session',
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
            secure: options.secure,
            sameSite: 'lax',
            maxAge: 8 * 60 * 60 * 1000,
            path: '/',
        },
    });
}
