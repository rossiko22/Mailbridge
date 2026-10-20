import { type SafeUser, toSafeUser } from './users.types.js';
import type { UserRepository } from './users.repository.js';
import { AppError } from '../../http/errors.js';
import { hashPassword, verifyHashPassword } from '../../security/password.js';
import type { UUID } from 'node:crypto';
import { parseAvatar } from './avatar.js';

// Verified when the address has no account, so an unknown address takes as long to refuse as a wrong password
// and the response time does not reveal who is registered.
let decoyHash: Promise<string> | undefined;

export function createUserService(userRepository: UserRepository) {
    async function create(email: string, password: string, displayName = ''): Promise<SafeUser> {
        const normalizedEmail = email.trim();
        const user = await userRepository.findByEmail(normalizedEmail);

        if (user) {
            throw new AppError(409, 'email_taken', 'An account with this email already exists.');
        }

        const hashedPassword = await hashPassword(password);

        const createdUser = await userRepository.create(normalizedEmail, hashedPassword, displayName.trim());

        return toSafeUser(createdUser);
    }

    async function validateLogin(email: string, password: string): Promise<SafeUser | null> {
        const user = await userRepository.findByEmail(email);

        if (!user) {
            decoyHash ??= hashPassword('decoy-password-that-nobody-has');
            await verifyHashPassword(await decoyHash, password);
            return null;
        }

        const passwordMatches = await verifyHashPassword(user.passwordHash, password);

        if (!passwordMatches || !user.isActive) {
            return null;
        }

        return toSafeUser(user);
    }
    async function changePassword(userId: UUID, currentPassword: string, newPassword: string) {
        const user = await userRepository.findById(userId);
        if (!user?.isActive || !(await verifyHashPassword(user.passwordHash, currentPassword))) return false;
        await userRepository.updatePassword(userId, await hashPassword(newPassword));
        return true;
    }
    async function updateDisplayName(userId: UUID, displayName: string): Promise<SafeUser> {
        await userRepository.updateDisplayName(userId, displayName.trim());
        const user = await userRepository.findById(userId);
        if (!user) throw new Error('User not found');
        return toSafeUser(user);
    }
    // Returns false when the upload is not a valid, small PNG, JPEG or WebP image.
    async function setAvatar(userId: UUID, dataUrl: unknown): Promise<boolean> {
        const image = parseAvatar(dataUrl);
        if (!image) return false;
        await userRepository.setAvatar(userId, image.contentType, image.data);
        return true;
    }
    return {
        changePassword,
        create,
        validateLogin,
        updateDisplayName,
        setAvatar,
        getAvatar: userRepository.getAvatar,
        removeAvatar: userRepository.removeAvatar,
    };
}
