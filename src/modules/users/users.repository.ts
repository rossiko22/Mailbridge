import type { UUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withTransaction } from '../../config/database.js';
import type { AvatarImage, User } from './users.types.js';

const columns = `
    u.user_id AS "userId",
    u.email,
    u.display_name AS "displayName",
    u.password_hash AS "passwordHash",
    u.is_active AS "isActive",
    u.created_at AS "createdAt",
    u.updated_at AS "updatedAt",
    (SELECT a.updated_at FROM user_avatars a WHERE a.user_id = u.user_id) AS "avatarUpdatedAt"`;

export function createUserRepository(pool: Pool) {
    async function findByEmail(email: string): Promise<User | null> {
        const result = await pool.query<User>(`SELECT ${columns} FROM users u WHERE lower(u.email) = lower($1)`, [email.trim()]);
        return result.rows[0] ?? null;
    }

    async function findById(id: UUID): Promise<User | null> {
        const result = await pool.query<User>(`SELECT ${columns} FROM users u WHERE u.user_id = $1`, [id.trim()]);
        return result.rows[0] ?? null;
    }

    // A duplicate address fails on the users_email_unique index, which the error middleware turns into a 409.
    async function create(email: string, passwordHash: string, displayName: string): Promise<User> {
        const result = await pool.query<{ userId: UUID }>(
            `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING user_id AS "userId"`,
            [email.trim(), passwordHash, displayName],
        );
        const createdUser = result.rows[0] && (await findById(result.rows[0].userId));
        if (!createdUser) throw new Error('User creating returned no row');
        return createdUser;
    }

    // Changing the password also signs the person out of every session.
    async function updatePassword(userId: UUID, passwordHash: string): Promise<void> {
        await withTransaction(pool, async client => {
            await client.query('UPDATE users SET password_hash=$2 WHERE user_id=$1', [userId, passwordHash]);
            await client.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [userId]);
        });
    }

    async function updateDisplayName(userId: UUID, displayName: string): Promise<void> {
        await pool.query('UPDATE users SET display_name=$2 WHERE user_id=$1', [userId, displayName]);
    }

    async function getAvatar(userId: UUID): Promise<AvatarImage | null> {
        const result = await pool.query<AvatarImage>(
            `SELECT content_type AS "contentType", data, updated_at AS "updatedAt" FROM user_avatars WHERE user_id=$1`,
            [userId],
        );
        return result.rows[0] ?? null;
    }

    async function setAvatar(userId: UUID, contentType: AvatarImage['contentType'], data: Buffer): Promise<void> {
        await pool.query(
            `INSERT INTO user_avatars (user_id, content_type, data) VALUES ($1,$2,$3)
            ON CONFLICT (user_id) DO UPDATE SET content_type=EXCLUDED.content_type, data=EXCLUDED.data, updated_at=NOW()`,
            [userId, contentType, data],
        );
    }

    async function removeAvatar(userId: UUID): Promise<void> {
        await pool.query('DELETE FROM user_avatars WHERE user_id=$1', [userId]);
    }

    // Only the hash of a reset token is stored; a database leak cannot be used to reset passwords.
    // A new request replaces any earlier unused one.
    async function createResetToken(userId: UUID, tokenHash: string, expiresAt: Date): Promise<void> {
        await withTransaction(pool, async client => {
            await client.query('DELETE FROM password_resets WHERE user_id=$1', [userId]);
            await client.query('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [
                tokenHash,
                userId,
                expiresAt,
            ]);
            await client.query("DELETE FROM password_resets WHERE expires_at < NOW() - INTERVAL '1 day'");
        });
    }

    // Spends the token, sets the password and signs the person out everywhere in one transaction.
    // Returns whose password was reset, or null when the token is unknown, used, expired or its account is inactive
    // (in which case nothing is changed).
    async function resetPassword(tokenHash: string, passwordHash: string): Promise<UUID | null> {
        return withTransaction(pool, async client => {
            const spent = await client.query<{ user_id: UUID }>(
                `UPDATE password_resets r SET used_at=NOW() FROM users u
                WHERE r.token_hash=$1 AND r.used_at IS NULL AND r.expires_at > NOW() AND u.user_id = r.user_id AND u.is_active
                RETURNING r.user_id`,
                [tokenHash],
            );
            const userId = spent.rows[0]?.user_id;
            if (!userId) return null;
            await client.query('UPDATE users SET password_hash=$2 WHERE user_id=$1', [userId, passwordHash]);
            await client.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [userId]);
            await client.query('DELETE FROM password_resets WHERE user_id=$1', [userId]);
            return userId;
        });
    }

    return {
        findByEmail,
        findById,
        create,
        updatePassword,
        updateDisplayName,
        getAvatar,
        setAvatar,
        removeAvatar,
        createResetToken,
        resetPassword,
    };
}
export type UserRepository = ReturnType<typeof createUserRepository>;
