import { z } from 'zod';
import { displayName, EMAIL_MAX, emailAddress, newPassword, PASSWORD_MAX } from '../../http/validate.js';

// Request bodies of /auth, as in contracts/openapi.yaml. Strict objects: an unknown field is a 400.

// Sign-in does not check the address format: any wrong input gets the same answer as a wrong password.
export const loginBody = z.strictObject({
    email: z.string().trim().min(1).max(EMAIL_MAX),
    password: z.string().min(1).max(PASSWORD_MAX),
});

export const registerBody = z.strictObject({
    email: emailAddress,
    password: newPassword,
    displayName: displayName.default(''),
});

export const forgotBody = z.strictObject({ email: emailAddress });

const resetLinkRule = 'This reset link is invalid or has expired. Request a new one.';
export const resetBody = z.strictObject({
    token: z.string({ error: resetLinkRule }).regex(/^[\w-]{20,100}$/, { error: resetLinkRule }),
    password: newPassword,
});

export const changePasswordBody = z.strictObject({
    currentPassword: z
        .string({ error: 'Provide your current password.' })
        .min(1, { error: 'Provide your current password.' })
        .max(PASSWORD_MAX),
    newPassword,
});
