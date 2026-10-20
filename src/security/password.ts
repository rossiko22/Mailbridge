import argon2 from 'argon2';
import crypto from 'node:crypto';

export async function hashPassword(plainPassword: string): Promise<string> {
    const salt = crypto.randomBytes(16);

    return await argon2.hash(plainPassword, {
        type: argon2.argon2id,
        salt,
        memoryCost: 131072, // 128 mib
        timeCost: 3,
        parallelism: 2,
    });
}

export async function verifyHashPassword(storedHash: string, plainPassword: string): Promise<boolean> {
    try {
        return await argon2.verify(storedHash, plainPassword);
    } catch (error) {
        throw new Error('Password verification failed', { cause: error });
    }
}
