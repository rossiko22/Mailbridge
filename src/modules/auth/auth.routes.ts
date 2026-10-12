import type {createAuthController} from "./auth.controller.js";
import {Router} from "express";
import type { createAuthMiddleware } from '../../middleware/auth.middleware.js';

type AuthController = ReturnType<typeof createAuthController>;

export function createAuthRouter(authController: AuthController, auth: ReturnType<typeof createAuthMiddleware>) {
    const router = Router();

    router.post("/login", authController.login);
    router.post('/password', auth.requireAuth, authController.changePassword);
    router.get('/me', auth.requireAuth, (req, res) => {
        res.set('Cache-Control', 'no-store').json({ user: req.currentUser });
    });
    router.post('/logout', (req, res, next) => {
        if (!req.is('application/json') || req.get('Sec-Fetch-Site') === 'cross-site') {
            res.status(415).json({ message: 'Use a same-site application/json request.' }); return;
        }
        req.session.destroy(error => {
            if (error) { next(error); return; }
            res.clearCookie('session', { path: '/' });
            res.json({ loggedOut: true });
        });
    });

    return router;
}
