import type * as repository from "../modules/users/users.repository.js";
import type { NextFunction, Request, Response } from "express";
import { toSafeUser } from "../modules/users/users.types.js";

type UserRepository = typeof repository;

export function createAuthMiddleware(userRepository: UserRepository) {
    async function requireAuth(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        try {
            const userId = req.session.userId;

            if (!userId) {
                res.status(401).json({
                    message: "Authentication required",
                });
                return;
            }

            const user = await userRepository.findById(userId);

            if (!user || !user.isActive) {
                res.status(401).json({
                    message: "Authentication required",
                })
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
    }
}
