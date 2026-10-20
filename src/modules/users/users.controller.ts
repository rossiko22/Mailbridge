import type { createUserService } from './users.service.js';
import type { Request, Response, NextFunction } from 'express';
import { MAX_AVATAR_BYTES } from './avatar.js';
import { sendError } from '../../http/errors.js';

type UserService = ReturnType<typeof createUserService>;

export const MAX_DISPLAY_NAME = 80;

export function createUserController(userService: UserService) {
    async function updateProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { displayName } = req.body ?? {};
            if (typeof displayName !== 'string' || displayName.trim().length > MAX_DISPLAY_NAME || /[\x00-\x1f\x7f]/.test(displayName)) {
                sendError(res, 400, 'validation_failed', `Enter a name of up to ${MAX_DISPLAY_NAME} characters.`);
                return;
            }
            res.json({ user: await userService.updateDisplayName(req.currentUser!.userId, displayName) });
        } catch (error: unknown) {
            next(error);
        }
    }

    async function uploadAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!(await userService.setAvatar(req.currentUser!.userId, req.body?.image))) {
                sendError(res, 400, 'validation_failed', `Choose a PNG, JPEG or WebP image of up to ${MAX_AVATAR_BYTES / 1024} KB.`);
                return;
            }
            res.json({ saved: true });
        } catch (error: unknown) {
            next(error);
        }
    }

    async function showAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const avatar = await userService.getAvatar(req.currentUser!.userId);
            if (!avatar) {
                sendError(res, 404, 'not_found', 'No profile photo.');
                return;
            }
            // The URL carries the upload time, so the browser may keep it privately for a long while.
            res.set({
                'Cache-Control': 'private, max-age=31536000, immutable',
                'X-Content-Type-Options': 'nosniff',
                'Content-Security-Policy': "default-src 'none'; sandbox",
            })
                .type(avatar.contentType)
                .send(avatar.data);
        } catch (error: unknown) {
            next(error);
        }
    }

    async function deleteAvatar(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            await userService.removeAvatar(req.currentUser!.userId);
            res.json({ removed: true });
        } catch (error: unknown) {
            next(error);
        }
    }

    return { updateProfile, uploadAvatar, showAvatar, deleteAvatar };
}
