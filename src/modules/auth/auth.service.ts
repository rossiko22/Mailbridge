import { createHash, randomBytes } from 'node:crypto';
import type { Mailer } from '../../integrations/mailer.js';
import { hashPassword } from '../../security/password.js';
import type * as repository from '../users/users.repository.js';

type UserRepository = typeof repository;

export const RESET_MINUTES = 30;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function createAuthService(userRepository: UserRepository, mailer: Mailer, publicOrigin: string, now: () => number = Date.now) {
    // Always completes quietly, whether or not the address has an account, so the form cannot be used to find out who is registered.
    async function requestPasswordReset(email: string): Promise<void> {
        const user = await userRepository.findByEmail(email);
        if (!user?.isActive) return;
        const token = randomBytes(32).toString('base64url');
        await userRepository.createResetToken(user.userId, hashToken(token), new Date(now() + RESET_MINUTES * 60_000));
        // The token travels in the URL fragment, which browsers never send to servers or in Referer headers.
        // Delivery runs in the background so the response time does not reveal whether the account exists.
        void mailer.sendPasswordReset(user.email, `${publicOrigin}/reset.html#token=${token}`, RESET_MINUTES)
            .catch(error => console.error(JSON.stringify({ event: 'reset-mail-failed', name: error instanceof Error ? error.name : 'Unknown' })));
    }

    async function resetPassword(token: string, newPassword: string): Promise<string | null> {
        return userRepository.resetPassword(hashToken(token), await hashPassword(newPassword));
    }

    return { requestPasswordReset, resetPassword };
}
export type AuthService = ReturnType<typeof createAuthService>;
