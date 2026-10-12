
import {Role, type SafeUser, type User} from "./users.types.js";
import type * as repository from "./users.repository.js";
import {hashPassword, verifyHashPassword} from "../../security/password.js";
import type { UUID } from 'node:crypto';


type UserRepository = typeof repository;

function toSafeUser(user: User): SafeUser {
    const { passwordHash, ...safeUser } = user;
    return safeUser;
}

export function createUserService(userRepository: UserRepository) {
    async function create(
        email: string,
        password: string,
        role: Role,
        avatarPath: string
    ): Promise<SafeUser> {

        const normalizedEmail = email.trim();
        const user = await userRepository.findByEmail(normalizedEmail);

        if (user) {
            throw new Error("User already exists");
        }

        const hashedPassword = await hashPassword(password);

        const createdUser = await userRepository.create(normalizedEmail, hashedPassword, role, avatarPath);

        return toSafeUser(createdUser);
    }

    async function validateLogin(email: string, password: string): Promise<SafeUser | null>{
        const user = await userRepository.findByEmail(email);

        if (!user) {
            return null;
        }

        const passwordMatches = await verifyHashPassword(user.passwordHash, password);

        if(!passwordMatches || !user.isActive) {
            return null;
        }

        return toSafeUser(user);
    }
    async function changePassword(userId: UUID, currentPassword: string, newPassword: string) {
        const user = await userRepository.findById(userId);
        if (!user?.isActive || !await verifyHashPassword(user.passwordHash, currentPassword)) return false;
        await userRepository.updatePassword(userId, await hashPassword(newPassword));
        return true;
    }
    return {
        changePassword,
        create,
        validateLogin,
    }
}
