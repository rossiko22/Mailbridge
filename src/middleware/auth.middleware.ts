import type * as repository from "../modules/users/users.repository.js";
import type { NextFunction, Request, Response } from "express";
import type {Role} from "../modules/users/users.types.js";

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

            const {passwordHash, ...safeUser} = user;
            req.currentUser = safeUser;

            next();
        } catch (error: unknown) {
            next(error);
        }
    }

    function requireRole(allowedRole: Role) {
        return (
            req: Request,
            res: Response,
            next: NextFunction
        ): void => {
            if(!req.currentUser) {
                res.status(401).json({
                    message: "Authentication required",
                });
                return;
            }

            if(req.currentUser.role !== allowedRole) {
                res.status(403).json({
                    message: "You do not have permission to use this action",
                });
                return;
            }

            next();
        };
    }
    return {
        requireAuth,
        requireRole,
    }
}
