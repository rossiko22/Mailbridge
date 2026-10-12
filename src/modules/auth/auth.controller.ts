import type {Request, Response, NextFunction} from "express";
import type {createUserService} from "../users/users.service.js";

type UserService = ReturnType<typeof createUserService>;

export function createAuthController(userService: UserService) {
    async function login(
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
                !("password" in body)
            ){
                res.status(400).json(
                    {message: "Email or password are required"},
                );
                return;
            }

            const { email, password } = body;

            if(
                typeof email !== "string" ||
                typeof password !== "string" ||
                email.trim() === "" ||
                email.length > 254 || password.length > 1024 || password === ""
            ){
                res.status(400).json({
                    message: "Invalid email or password."
                })
                return;
            }

            const user = await userService.validateLogin(email, password);

            if(!user){
                res.status(401).json({
                    message: "Invalid email or password."
                })
                return;
            }

            // Session creation will go here
            await new Promise<void>((resolve, reject) => {
                req.session.regenerate((error => {
                    if(error){
                        reject(error);
                        return;
                    }

                    resolve();
                }));
            });

            // Store only the user ID, not the password or password hash
            req.session.userId = user.userId;

            // Persist the session before reporting success
            await new Promise<void>((resolve, reject) => {
                req.session.save((error) => {
                    if(error){
                        reject(error);
                        return;
                    }

                    resolve();
                });
            });

            res.status(200).json({user})
        } catch (error: unknown) {
            next(error);
        }
    }
    async function changePassword(req: Request, res: Response, next: NextFunction) {
        try {
            const { currentPassword, newPassword } = req.body ?? {};
            if (typeof currentPassword !== 'string' || currentPassword.length > 1024 || typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 1024) {
                res.status(400).json({ message: 'Provide your current password and a new password of 12–1024 characters.' }); return;
            }
            if (!await userService.changePassword(req.currentUser!.userId, currentPassword, newPassword)) {
                res.status(400).json({ message: 'Current password is incorrect.' }); return;
            }
            await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
            res.clearCookie('session', { path: '/' }).json({ changed: true });
        } catch (error) { next(error); }
    }
    return { login, changePassword };
}
