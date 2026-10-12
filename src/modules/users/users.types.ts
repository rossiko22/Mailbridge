import type {UUID} from "node:crypto";

export type User = {
    userId: UUID,
    email: string,
    displayName: string,
    passwordHash: string,
    isActive: boolean,
    createdAt: Date,
    updatedAt: Date,
    avatarUpdatedAt: Date | null,
}

// What the browser may see. The avatar URL changes whenever the photo does, so caches never go stale.
export type SafeUser = {
    userId: UUID,
    email: string,
    displayName: string,
    isActive: boolean,
    createdAt: Date,
    updatedAt: Date,
    avatarUrl: string | null,
}

export function toSafeUser(user: User): SafeUser {
    const { passwordHash, avatarUpdatedAt, ...rest } = user;
    return { ...rest, avatarUrl: avatarUpdatedAt ? `/users/me/avatar?v=${new Date(avatarUpdatedAt).getTime()}` : null };
}

export type AvatarImage = { contentType: 'image/png' | 'image/jpeg' | 'image/webp', data: Buffer, updatedAt: Date };
