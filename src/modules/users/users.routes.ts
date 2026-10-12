import type {createUserController} from "./users.controller.js";
import type {createAuthMiddleware} from "../../middleware/auth.middleware.js";
import {Router} from "express";

type UserController = ReturnType<typeof createUserController>;
type AuthMiddleware = ReturnType<typeof createAuthMiddleware>;

export function createUserRouter(
    userController: UserController,
    authMiddleware: AuthMiddleware
) {
    const router = Router();

    router.use(authMiddleware.requireAuth);
    router.patch("/me", userController.updateProfile);
    router.get("/me/avatar", userController.showAvatar);
    router.put("/me/avatar", userController.uploadAvatar);
    router.delete("/me/avatar", userController.deleteAvatar);

    return router;
}
