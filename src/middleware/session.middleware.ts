import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';

import { pool } from '../config/database.js';
import { env } from '../config/env.js';

const PostgresSessionStore = connectPgSimple(session);

export const sessionMiddleware = session({
    name: 'session',
    secret: env.SESSION_SECRET,
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
        secure: env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 8 * 60 * 60 * 1000,
        path: '/',
    },
});
