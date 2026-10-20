import { Router } from 'express';
import { AppError } from '../../http/errors.js';
import { emptyBody, parse } from '../../http/validate.js';
import type { createAuthMiddleware } from '../../middleware/auth.middleware.js';
import { avatarBody, avatarQuery, avatarRule, updateProfileBody } from './users.schemas.js';
import type { UserService } from './users.service.js';

export interface UserRouterOptions {
    users: UserService;
    requireAuth: ReturnType<typeof createAuthMiddleware>['requireAuth'];
}

export function createUserRouter({ users, requireAuth }: UserRouterOptions) {
    const router = Router();
    router.use(requireAuth);

    router.patch('/me', async (req, res) => {
        const { displayName } = parse(updateProfileBody, req.body);
        res.json({ user: await users.updateDisplayName(req.currentUser!.userId, displayName) });
    });

    router.get('/me/avatar', async (req, res) => {
        parse(avatarQuery, req.query);
        const avatar = await users.getAvatar(req.currentUser!.userId);
        if (!avatar) throw new AppError(404, 'not_found', 'No profile photo.');
        // The URL carries the upload time, so the browser may keep it privately for a long while.
        res.set({
            'Cache-Control': 'private, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'none'; sandbox",
        })
            .type(avatar.contentType)
            .send(avatar.data);
    });

    router.put('/me/avatar', async (req, res) => {
        const { image } = parse(avatarBody, req.body);
        if (!(await users.setAvatar(req.currentUser!.userId, image))) throw new AppError(400, 'validation_failed', avatarRule);
        res.json({ saved: true });
    });

    router.delete('/me/avatar', async (req, res) => {
        parse(emptyBody, req.body);
        await users.removeAvatar(req.currentUser!.userId);
        res.json({ removed: true });
    });

    return router;
}
