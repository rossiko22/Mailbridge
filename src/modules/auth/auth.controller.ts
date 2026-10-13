import type {Request, Response, NextFunction} from "express";
import type {createUserService} from "../users/users.service.js";
import type {SafeUser} from "../users/users.types.js";
import type {AuthService} from "./auth.service.js";
import { EMAIL_MAX, PASSWORD_MAX, passwordRule, validEmail, validNewPassword } from "./auth.validation.js";
import { MAX_DISPLAY_NAME } from "../users/users.controller.js";
import { noAudit, type Audit } from "../audit/audit.js";

type UserService = ReturnType<typeof createUserService>;

export function createAuthController(userService: UserService, authService: AuthService, allowRegistration = true, audit: Audit = noAudit) {
    // Replaces the session ID (preventing fixation) and stores only the user ID.
    async function startSession(req: Request, user: SafeUser): Promise<void> {
        await new Promise<void>((resolve, reject) => {
            req.session.regenerate(error => error ? reject(error) : resolve());
        });
        req.session.userId = user.userId;
        await new Promise<void>((resolve, reject) => {
            req.session.save(error => error ? reject(error) : resolve());
        });
    }

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
                email.length > EMAIL_MAX || password.length > PASSWORD_MAX || password === ""
            ){
                res.status(400).json({
                    message: "Invalid email or password."
                })
                return;
            }

            const user = await userService.validateLogin(email, password);

            if(!user){
                await audit.record(req, 'sign-in', 'failure', { email });
                res.status(401).json({
                    message: "Invalid email or password."
                })
                return;
            }

            await startSession(req, user);
            await audit.record(req, 'sign-in', 'success', { userId: user.userId });
            res.status(200).json({user})
        } catch (error: unknown) {
            next(error);
        }
    }

    async function register(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            if (!allowRegistration) {
                res.status(403).json({ message: 'Registration is turned off on this server.' });
                return;
            }
            const { email, password, displayName = '' } = req.body ?? {};
            if (!validEmail(email)) { res.status(400).json({ message: 'Enter a valid email address.' }); return; }
            if (!validNewPassword(password)) { res.status(400).json({ message: passwordRule }); return; }
            if (typeof displayName !== 'string' || displayName.trim().length > MAX_DISPLAY_NAME || /[\x00-\x1f\x7f]/.test(displayName)) {
                res.status(400).json({ message: `Enter a name of up to ${MAX_DISPLAY_NAME} characters.` });
                return;
            }
            const user = await userService.create(email, password, displayName);
            await startSession(req, user);
            await audit.record(req, 'register', 'success', { userId: user.userId });
            res.status(201).json({ user });
        } catch (error: unknown) {
            next(error);
        }
    }

    async function forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { email } = req.body ?? {};
            if (!validEmail(email)) { res.status(400).json({ message: 'Enter a valid email address.' }); return; }
            await authService.requestPasswordReset(email);
            await audit.record(req, 'password-reset-request', 'success', { email });
            res.json({ message: 'If an account exists for that address, a reset link is on its way. It stays valid for 30 minutes.' });
        } catch (error: unknown) {
            next(error);
        }
    }

    async function resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
        try {
            const { token, password } = req.body ?? {};
            if (typeof token !== 'string' || !/^[\w-]{20,100}$/.test(token)) {
                res.status(400).json({ message: 'This reset link is invalid or has expired. Request a new one.' });
                return;
            }
            if (!validNewPassword(password)) { res.status(400).json({ message: passwordRule }); return; }
            const userId = await authService.resetPassword(token, password);
            if (!userId) {
                await audit.record(req, 'password-reset', 'failure');
                res.status(400).json({ message: 'This reset link is invalid or has expired. Request a new one.' });
                return;
            }
            await audit.record(req, 'password-reset', 'success', { userId });
            res.json({ reset: true });
        } catch (error: unknown) {
            next(error);
        }
    }

    async function changePassword(req: Request, res: Response, next: NextFunction) {
        try {
            const { currentPassword, newPassword } = req.body ?? {};
            if (typeof currentPassword !== 'string' || currentPassword.length > PASSWORD_MAX || !validNewPassword(newPassword)) {
                res.status(400).json({ message: `Provide your current password. ${passwordRule}` }); return;
            }
            if (!await userService.changePassword(req.currentUser!.userId, currentPassword, newPassword)) {
                await audit.record(req, 'password-change', 'failure');
                res.status(400).json({ message: 'Current password is incorrect.' }); return;
            }
            await audit.record(req, 'password-change', 'success');
            await new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
            res.clearCookie('session', { path: '/' }).json({ changed: true });
        } catch (error) { next(error); }
    }
    // Lets the sign-in page show or hide "Create account" without trying it.
    function config(_req: Request, res: Response): void {
        res.json({ registration: allowRegistration });
    }
    return { login, register, forgotPassword, resetPassword, changePassword, config };
}
