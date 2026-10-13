import type {AvatarImage, User} from "./users.types.js";
import {pool} from "../../config/database.js";
import type {UUID} from "node:crypto";

const columns = `
    u.user_id AS "userId",
    u.email,
    u.display_name AS "displayName",
    u.password_hash AS "passwordHash",
    u.is_active AS "isActive",
    u.created_at AS "createdAt",
    u.updated_at AS "updatedAt",
    (SELECT a.updated_at FROM user_avatars a WHERE a.user_id = u.user_id) AS "avatarUpdatedAt"`;

export async function updatePassword(userId: UUID, passwordHash: string): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('UPDATE users SET password_hash=$2 WHERE user_id=$1', [userId,passwordHash]);
        await client.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [userId]);
        await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}

export async function findByEmail(email: string): Promise<User | null>{
    const result = await pool.query<User>(
        `SELECT ${columns} FROM users u WHERE lower(u.email) = lower($1)`,
        [email.trim()],
    )

    return result.rows[0] ?? null;
}

export async function findById(id: UUID): Promise<User | null>{
    const result = await pool.query<User>(
        `SELECT ${columns} FROM users u WHERE u.user_id = $1`,
        [id.trim()],
    )

    return result.rows[0] ?? null;
}

export async function create(email: string, passwordHash: string, displayName: string): Promise<User> {
    const user = await findByEmail(email);

    if (user) {
        throw new Error("User already exists");
    }

    const result = await pool.query<{ userId: UUID }>(
        `INSERT INTO users (email, password_hash, display_name) VALUES ($1, $2, $3) RETURNING user_id AS "userId"`,
        [email.trim(), passwordHash, displayName]
    )

    const createdUser = result.rows[0] && await findById(result.rows[0].userId);

    if(!createdUser) {
        throw new Error("User creating returned no row");
    }

    return createdUser;
}

export async function updateDisplayName(userId: UUID, displayName: string): Promise<void> {
    await pool.query('UPDATE users SET display_name=$2 WHERE user_id=$1', [userId, displayName]);
}

export async function getAvatar(userId: UUID): Promise<AvatarImage | null> {
    const result = await pool.query<AvatarImage>(
        `SELECT content_type AS "contentType", data, updated_at AS "updatedAt" FROM user_avatars WHERE user_id=$1`, [userId]);
    return result.rows[0] ?? null;
}

export async function setAvatar(userId: UUID, contentType: AvatarImage['contentType'], data: Buffer): Promise<void> {
    await pool.query(`INSERT INTO user_avatars (user_id, content_type, data) VALUES ($1,$2,$3)
        ON CONFLICT (user_id) DO UPDATE SET content_type=EXCLUDED.content_type, data=EXCLUDED.data, updated_at=NOW()`,
        [userId, contentType, data]);
}

export async function removeAvatar(userId: UUID): Promise<void> {
    await pool.query('DELETE FROM user_avatars WHERE user_id=$1', [userId]);
}

// Only the hash of a reset token is stored; a database leak cannot be used to reset passwords.
// A new request replaces any earlier unused one.
export async function createResetToken(userId: UUID, tokenHash: string, expiresAt: Date): Promise<void> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query('DELETE FROM password_resets WHERE user_id=$1', [userId]);
        await client.query('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES ($1,$2,$3)', [tokenHash, userId, expiresAt]);
        await client.query("DELETE FROM password_resets WHERE expires_at < NOW() - INTERVAL '1 day'");
        await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}

// Spends the token, sets the password and signs the person out everywhere in one transaction.
// Returns whose password was reset, or null when the token is unknown, used or expired.
export async function resetPassword(tokenHash: string, passwordHash: string): Promise<UUID | null> {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const spent = await client.query<{ user_id: UUID }>(
            `UPDATE password_resets SET used_at=NOW() WHERE token_hash=$1 AND used_at IS NULL AND expires_at > NOW() RETURNING user_id`, [tokenHash]);
        const userId = spent.rows[0]?.user_id;
        if (!userId) { await client.query('ROLLBACK'); return null; }
        const updated = await client.query('UPDATE users SET password_hash=$2 WHERE user_id=$1 AND is_active=TRUE', [userId, passwordHash]);
        if (!updated.rowCount) { await client.query('ROLLBACK'); return null; }
        await client.query("DELETE FROM sessions WHERE sess->>'userId'=$1", [userId]);
        await client.query('DELETE FROM password_resets WHERE user_id=$1', [userId]);
        await client.query('COMMIT');
        return userId;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
}
