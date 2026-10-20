import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CredentialStore, ProviderId } from '../../integrations/mail/types.js';
import { withTransaction } from '../../config/database.js';
import { tokenVault } from '../../security/token-vault.js';

// Colors are CSS classes in the design system; accounts get the first unused one.
export const accountColors = ['blue', 'teal', 'purple', 'orange', 'green', 'pink', 'red', 'gray'] as const;

export interface Account {
    id: string;
    provider: ProviderId;
    email: string;
    displayName: string;
    color: string;
    isDemo: boolean;
    needsReconnect: boolean;
    lastError: string | null;
    syncedAt: Date | null;
    total: number;
    unread: number;
}

const columns = `a.account_id AS id, a.provider, a.email, a.display_name AS "displayName", a.color, a.is_demo AS "isDemo",
    a.needs_reconnect AS "needsReconnect", a.last_error AS "lastError", a.synced_at AS "syncedAt",
    COALESCE(c.total, 0)::int AS total, COALESCE(c.unread, 0)::int AS unread`;
const counts = `LEFT JOIN LATERAL (SELECT count(*) AS total, count(*) FILTER (WHERE NOT e.is_read) AS unread
    FROM emails e WHERE e.account_id = a.account_id) c ON TRUE`;

export function createAccountsRepository(pool: Pool, secret: string) {
    async function list(userId: string): Promise<Account[]> {
        const { rows } = await pool.query<Account>(
            `SELECT ${columns} FROM mail_accounts a ${counts} WHERE a.user_id = $1 ORDER BY a.created_at, a.account_id`,
            [userId],
        );
        return rows;
    }

    async function get(userId: string, accountId: string): Promise<Account | undefined> {
        const { rows } = await pool.query<Account>(
            `SELECT ${columns} FROM mail_accounts a ${counts} WHERE a.user_id = $1 AND a.account_id = $2`,
            [userId, accountId],
        );
        return rows[0];
    }

    // Connecting an account that already exists renews its sign-in instead of adding a duplicate.
    async function upsertConnected(userId: string, provider: ProviderId, email: string, displayName: string, credentials: string) {
        return withTransaction(pool, async client => {
            await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`account:${userId}:${provider}:${email.toLowerCase()}`]);
            const existing = await client.query<{ account_id: string }>(
                'SELECT account_id FROM mail_accounts WHERE user_id=$1 AND provider=$2 AND lower(email)=lower($3)',
                [userId, provider, email],
            );
            const id = existing.rows[0]?.account_id ?? randomUUID();
            const encrypted = tokenVault(secret, id).encrypt(credentials);
            if (existing.rows[0]) {
                await client.query(
                    `UPDATE mail_accounts SET credentials=$2, display_name=$3, needs_reconnect=FALSE, last_error=NULL
                WHERE account_id=$1`,
                    [id, encrypted, displayName],
                );
            } else {
                const used = await client.query<{ color: string }>('SELECT color FROM mail_accounts WHERE user_id=$1', [userId]);
                const taken = new Set(used.rows.map(row => row.color));
                const color = accountColors.find(item => !taken.has(item)) ?? accountColors[used.rows.length % accountColors.length]!;
                await client.query(
                    `INSERT INTO mail_accounts (account_id, user_id, provider, email, display_name, color, credentials)
                VALUES ($1,$2,$3,$4,$5,$6,$7)`,
                    [id, userId, provider, email, displayName, color, encrypted],
                );
            }
            return { id, created: !existing.rows[0] };
        });
    }

    async function remove(userId: string, accountId: string): Promise<boolean> {
        const result = await pool.query('DELETE FROM mail_accounts WHERE user_id=$1 AND account_id=$2', [userId, accountId]);
        return (result.rowCount ?? 0) > 0;
    }

    async function markError(accountId: string, message: string, needsReconnect: boolean) {
        await pool.query('UPDATE mail_accounts SET last_error=$2, needs_reconnect = needs_reconnect OR $3 WHERE account_id=$1', [
            accountId,
            message.slice(0, 500),
            needsReconnect,
        ]);
    }

    // The account row is locked while credentials may change, so two refreshes never race.
    const credentialStore: CredentialStore = {
        async withCredentials(accountId, work) {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                const { rows } = await client.query<{ credentials: string | null }>(
                    'SELECT credentials FROM mail_accounts WHERE account_id=$1 FOR UPDATE',
                    [accountId],
                );
                if (!rows[0]) throw new Error('Account not found');
                const vault = tokenVault(secret, accountId);
                const result = await work(rows[0].credentials ? vault.decrypt(rows[0].credentials) : null, async next => {
                    await client.query('UPDATE mail_accounts SET credentials=$2 WHERE account_id=$1', [accountId, vault.encrypt(next)]);
                });
                await client.query('COMMIT');
                return result;
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        },
    };

    return { list, get, upsertConnected, remove, markError, credentialStore };
}
