import express from "express";
import * as userRepository from "./modules/users/users.repository.js";
import { sessionMiddleware } from "./middleware/session.middleware.js";
import {createUserService} from "./modules/users/users.service.js";
import {createAuthMiddleware} from "./middleware/auth.middleware.js";
import {createAuthController} from "./modules/auth/auth.controller.js";
import {createUserController} from "./modules/users/users.controller.js";
import {createAuthRouter} from "./modules/auth/auth.routes.js";
import {createUserRouter} from "./modules/users/users.routes.js";
import {createAuthService} from "./modules/auth/auth.service.js";
import {errorMiddleware} from "./middleware/error.middleware.js";
import {fileURLToPath} from "node:url";
import { pool } from './config/database.js';
import { env } from './config/env.js';
import { createMailer } from './integrations/mailer.js';
import { createMailRegistry } from './integrations/mail/registry.js';
import { createAccountsRepository } from './modules/accounts/accounts.repository.js';
import { createAccountsRouter } from './modules/accounts/accounts.routes.js';
import { createEmailRepository } from './modules/emails/emails.repository.js';
import { createEmailService } from './modules/emails/emails.service.js';
import { createEmailRouter } from './modules/emails/emails.routes.js';
import { requireSameSiteJson } from './middleware/json.middleware.js';
import { securityHeaders, throttle } from './middleware/security.middleware.js';
import { createAudit } from './modules/audit/audit.js';

export const app = express();

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.use(securityHeaders);
const audit = createAudit(pool);
// Requests turned away as cross-site, or throttled while signing in, are kept for review.
app.use((req, res, next) => {
    res.once('finish', () => {
        if (res.statusCode !== 415 && !(res.statusCode === 429 && req.path.startsWith('/auth/'))) return;
        void audit.record(req, 'request-refused', 'denied', {
            email: typeof req.body?.email === 'string' ? req.body.email : undefined,
            detail: { status: res.statusCode, method: req.method, path: req.path },
        });
    });
    next();
});
app.use(requireSameSiteJson);
// Profile photos arrive as small JSON data URLs; every other request body stays tiny.
const smallJson = express.json({ limit: '64kb' });
const photoJson = express.json({ limit: '800kb' });
app.use((req, res, next) => (req.path === '/users/me/avatar' ? photoJson : smallJson)(req, res, next));
app.use(sessionMiddleware);

const userService = createUserService(userRepository);
const authMiddleware = createAuthMiddleware(userRepository);
const authService = createAuthService(userRepository, createMailer(env.SMTP, env.NODE_ENV), env.PUBLIC_ORIGIN);

const authController = createAuthController(userService, authService, env.ALLOW_REGISTRATION, audit);
const userController = createUserController(userService);

app.post('/auth/login', throttle(pool, env.SESSION_SECRET, 'login', { perIp: 50, perAccount: 10 }, 'Too many sign-in attempts. Wait 15 minutes and try again.'));
app.post('/auth/register', throttle(pool, env.SESSION_SECRET, 'register', { perIp: 20, perAccount: 5 }));
app.post('/auth/forgot', throttle(pool, env.SESSION_SECRET, 'forgot', { perIp: 20, perAccount: 5 }));
app.post('/auth/reset', throttle(pool, env.SESSION_SECRET, 'reset', { perIp: 30 }));
app.use("/auth", createAuthRouter(authController, authMiddleware, audit));

app.use(
    "/users",
    createUserRouter(userController, authMiddleware)
)

const accounts = createAccountsRepository(pool, env.TOKEN_ENCRYPTION_KEY);
const registry = createMailRegistry({
    outlook: env.MICROSOFT ? { ...env.MICROSOFT, redirectUri: `${env.PUBLIC_ORIGIN}/accounts/callback/outlook` } : undefined,
    gmail: env.GOOGLE ? { ...env.GOOGLE, redirectUri: `${env.PUBLIC_ORIGIN}/accounts/callback/gmail` } : undefined,
    store: accounts.credentialStore,
});
const emailService = createEmailService(pool, createEmailRepository(pool), accounts, registry);
app.use('/accounts', createAccountsRouter(authMiddleware, accounts, registry, emailService, env.GMAIL_ALLOWED_EMAILS, audit));
app.use('/emails', createEmailRouter(authMiddleware, emailService, audit));

app.get('/health', async (_req, res) => {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
});

app.use(errorMiddleware);

const publicDirectory = fileURLToPath(
    new URL("../public/", import.meta.url),
);

app.use(express.static(publicDirectory, {
    setHeaders(res, path) {
        if (path.endsWith('.html') || path.endsWith('.js')) res.setHeader('Cache-Control', 'no-store');
    },
}));
