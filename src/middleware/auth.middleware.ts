import type { UserRepository } from '../modules/users/users.repository.js';
import type { NextFunction, Request, Response } from 'express';
import { toSafeUser } from '../modules/users/users.types.js';
import { sendError } from '../http/errors.js';

// Activity keeps a session alive for 8 hours at a time, but never beyond this.
export const MAX_SESSION_AGE = 7 * 24 * 60 * 60 * 1000;

export function createAuthMiddleware(userRepository: UserRepository, now: () => number = Date.now) {
    async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const userId = req.session.userId;

            if (!userId) {
                sendError(res, 401, 'unauthenticated', 'Authentication required');
                return;
            }

            req.session.signedInAt ??= now();
            if (now() - req.session.signedInAt > MAX_SESSION_AGE) {
                await new Promise<void>(resolve => req.session.destroy(() => resolve()));
                sendError(res, 401, 'unauthenticated', 'Authentication required');
                return;
            }

            const user = await userRepository.findById(userId);

            if (!user?.isActive) {
                sendError(res, 401, 'unauthenticated', 'Authentication required');
                return;
            }

            req.currentUser = toSafeUser(user);

            next();
        } catch (error: unknown) {
            next(error);
        }
    }

    return {
        requireAuth,
    };
}
