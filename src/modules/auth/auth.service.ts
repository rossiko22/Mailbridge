import { createHash, randomBytes } from 'node:crypto';
import type { Logger } from '../../config/logger.js';
import type { Mailer } from '../../integrations/mailer.js';
import { hashPassword } from '../../security/password.js';
import type { UserRepository } from '../users/users.repository.js';

export const RESET_MINUTES = 30;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export interface AuthServiceOptions {
    users: UserRepository;
    mailer: Mailer;
    publicOrigin: string;
    logger: Pick<Logger, 'error'>;
    now?: () => number;
}

export function createAuthService({ users: userRepository, mailer, publicOrigin, logger, now = Date.now }: AuthServiceOptions) {
    // Always completes quietly, whether or not the address has an account, so the form cannot be used to find out who is registered.
    async function requestPasswordReset(email: string): Promise<void> {
        const user = await userRepository.findByEmail(email);
        if (!user?.isActive) return;
        const token = randomBytes(32).toString('base64url');
        await userRepository.createResetToken(user.userId, hashToken(token), new Date(now() + RESET_MINUTES * 60_000));
        // The token travels in the URL fragment, which browsers never send to servers or in Referer headers.
        // Delivery runs in the background so the response time does not reveal whether the account exists.
        void mailer
            .sendPasswordReset(user.email, `${publicOrigin}/reset.html#token=${token}`, RESET_MINUTES)
            .catch(error => logger.error({ event: 'reset-mail-failed', err: error }, 'password reset mail failed'));
    }

    async function resetPassword(token: string, newPassword: string): Promise<string | null> {
        return userRepository.resetPassword(hashToken(token), await hashPassword(newPassword));
    }

    return { requestPasswordReset, resetPassword };
}
export type AuthService = ReturnType<typeof createAuthService>;
