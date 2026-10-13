import type {createAuthController} from "./auth.controller.js";
import {Router} from "express";
import type { createAuthMiddleware } from '../../middleware/auth.middleware.js';
import { noAudit, type Audit } from '../audit/audit.js';

type AuthController = ReturnType<typeof createAuthController>;

export function createAuthRouter(authController: AuthController, auth: ReturnType<typeof createAuthMiddleware>, audit: Audit = noAudit) {
    const router = Router();

    router.get("/config", authController.config);
    router.post("/login", authController.login);
    router.post("/register", authController.register);
    router.post("/forgot", authController.forgotPassword);
    router.post("/reset", authController.resetPassword);
    router.post('/password', auth.requireAuth, authController.changePassword);
    router.get('/me', auth.requireAuth, (req, res) => {
        res.set('Cache-Control', 'no-store').json({ user: req.currentUser });
    });
    // A person's own recent security events, shown in Settings.
    router.get('/activity', auth.requireAuth, async (req, res) => {
        res.set('Cache-Control', 'no-store').json({ events: await audit.recent(req.currentUser!.userId) });
    });
    router.post('/logout', (req, res, next) => {
        if (!req.is('application/json') || req.get('Sec-Fetch-Site') === 'cross-site') {
            res.status(415).json({ message: 'Use a same-site application/json request.' }); return;
        }
        const userId = req.session.userId;
        req.session.destroy(async error => {
            if (error) { next(error); return; }
            if (userId) await audit.record(req, 'sign-out', 'success', { userId });
            res.clearCookie('session', { path: '/' });
            res.json({ loggedOut: true });
        });
    });

    return router;
}
