import type {createUserService} from "./users.service.js";
import type {Request, Response, NextFunction} from "express";
import {Role} from "./users.types.js";

type UserService = ReturnType<typeof createUserService>;

export function createUserController(userService: UserService) {
    async function create(
        req: Request,
        res: Response,
        next: NextFunction
    ): Promise<void> {
        try{
            const body: unknown = req.body;

            if(
                typeof body !== "object" ||
                body === null ||
                !("email" in body) ||
                !("password" in body) ||
                !("role" in body) ||
                !("avatarPath" in body)
            ){
                res.status(400).json({
                    message: "Email, password, role and avatar path are required."
                });
                return;
            }

            const { email, password, role, avatarPath } = body;

            if(
                typeof email !== "string" ||
                typeof password !== "string" ||
                typeof avatarPath !== "string" ||
                email.trim() === "" ||
                password.length < 12 || password.length > 1024 || email.length > 254 ||
                avatarPath === ""
            ) {
                res.status(400).json({
                    message: "Provide an email (up to 254 characters), a password (12–1024 characters) and an avatar path.",
                })
                return;
            }

            // Basic format check, not verification of mailbox ownership.
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
                res.status(400).json({
                    message: "A valid email address is required.",
                });
                return;
            }

            if(
                role !== Role.SOFTWARE_DEVELOPER &&
                role !== Role.IT_MANAGER
            ) {
                res.status(400).json({
                    message: "Role must be 1 or 2",
                });
                return;
            }

            const user = await userService.create(
                email.trim(),
                password,
                role,
                avatarPath
            );

            res.status(201).json({ user });

        } catch (error: unknown) {
            next(error);
        }
    }
    return { create }
}
