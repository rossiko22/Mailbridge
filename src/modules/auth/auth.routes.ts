import { type Request, Router } from 'express';
import { AppError } from '../../http/errors.js';
import { emptyBody, parse } from '../../http/validate.js';
import type { createAuthMiddleware } from '../../middleware/auth.middleware.js';
import { type Audit, noAudit } from '../audit/audit.js';
import type { UserService } from '../users/users.service.js';
import type { SafeUser } from '../users/users.types.js';
import { changePasswordBody, forgotBody, loginBody, registerBody, resetBody } from './auth.schemas.js';
import type { AuthService } from './auth.service.js';

export interface AuthRouterOptions {
    users: UserService;
    auth: AuthService;
    requireAuth: ReturnType<typeof createAuthMiddleware>['requireAuth'];
    allowRegistration: boolean;
    audit?: Audit;
}

const regenerate = (req: Request) =>
    new Promise<void>((resolve, reject) => req.session.regenerate(error => (error ? reject(error) : resolve())));
const save = (req: Request) => new Promise<void>((resolve, reject) => req.session.save(error => (error ? reject(error) : resolve())));
const destroy = (req: Request) => new Promise<void>((resolve, reject) => req.session.destroy(error => (error ? reject(error) : resolve())));

// Replaces the session ID (preventing fixation) and stores only the user ID.
async function startSession(req: Request, user: SafeUser): Promise<void> {
    await regenerate(req);
    req.session.userId = user.userId;
    req.session.signedInAt = Date.now();
    await save(req);
}

export function createAuthRouter({ users, auth, requireAuth, allowRegistration, audit = noAudit }: AuthRouterOptions) {
    const router = Router();

    // Lets the sign-in page show or hide "Create account" without trying it.
    router.get('/config', (_req, res) => {
        res.json({ registration: allowRegistration });
    });

    router.post('/login', async (req, res) => {
        const { email, password } = parse(loginBody, req.body, 'Invalid email or password.');
        const user = await users.validateLogin(email, password);
        if (!user) {
            await audit.record(req, 'sign-in', 'failure', { email });
            throw new AppError(401, 'invalid_credentials', 'Invalid email or password.');
        }
        await startSession(req, user);
        await audit.record(req, 'sign-in', 'success', { userId: user.userId });
        res.json({ user });
    });

    router.post('/register', async (req, res) => {
        if (!allowRegistration) throw new AppError(403, 'registration_disabled', 'Registration is turned off on this server.');
        const { email, password, displayName } = parse(registerBody, req.body);
        const user = await users.create(email, password, displayName);
        await startSession(req, user);
        await audit.record(req, 'register', 'success', { userId: user.userId });
        res.status(201).json({ user });
    });

    router.post('/forgot', async (req, res) => {
        const { email } = parse(forgotBody, req.body);
        await auth.requestPasswordReset(email);
        await audit.record(req, 'password-reset-request', 'success', { email });
        res.json({ message: 'If an account exists for that address, a reset link is on its way. It stays valid for 30 minutes.' });
    });

    router.post('/reset', async (req, res) => {
        const { token, password } = parse(resetBody, req.body);
        const userId = await auth.resetPassword(token, password);
        if (!userId) {
            await audit.record(req, 'password-reset', 'failure');
            throw new AppError(400, 'invalid_reset_token', 'This reset link is invalid or has expired. Request a new one.');
        }
        await audit.record(req, 'password-reset', 'success', { userId });
        res.json({ reset: true });
    });

    router.post('/password', requireAuth, async (req, res) => {
        const { currentPassword, newPassword } = parse(changePasswordBody, req.body);
        if (!(await users.changePassword(req.currentUser!.userId, currentPassword, newPassword))) {
            await audit.record(req, 'password-change', 'failure');
            throw new AppError(400, 'wrong_password', 'Current password is incorrect.');
        }
        await audit.record(req, 'password-change', 'success');
        await destroy(req);
        res.clearCookie('session', { path: '/' }).json({ changed: true });
    });

    router.get('/me', requireAuth, (req, res) => {
        res.set('Cache-Control', 'no-store').json({ user: req.currentUser });
    });

    // A person's own recent security events, shown in Settings.
    router.get('/activity', requireAuth, async (req, res) => {
        res.set('Cache-Control', 'no-store').json({ events: await audit.recent(req.currentUser!.userId) });
    });

    // Cross-site sign-out attempts are already refused by requireSameSiteJson, like every other POST.
    router.post('/logout', async (req, res) => {
        parse(emptyBody, req.body);
        const userId = req.session.userId;
        await destroy(req);
        if (userId) await audit.record(req, 'sign-out', 'success', { userId });
        res.clearCookie('session', { path: '/' }).json({ loggedOut: true });
    });

    return router;
}
