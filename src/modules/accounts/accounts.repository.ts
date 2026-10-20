import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import type { CredentialStore, ProviderId, StoredCredentials } from '../../integrations/mail/types.js';
import { withTransaction } from '../../config/database.js';
import type { TokenVault } from '../../security/token-vault.js';

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

export function createAccountsRepository(pool: Pool, vault: TokenVault) {
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
            const encrypted = vault.seal(credentials, id);
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

    // Writes `next` only if the row still holds `expected`, so a concurrent refresh is never overwritten blindly.
    async function swapCredentials(accountId: string, expected: string, next: string): Promise<boolean> {
        const result = await pool.query('UPDATE mail_accounts SET credentials=$3 WHERE account_id=$1 AND credentials=$2', [
            accountId,
            expected,
            next,
        ]);
        return (result.rowCount ?? 0) > 0;
    }

    // Reads without a lock: no database connection is held while a provider talks to the network.
    const credentialStore: CredentialStore = {
        async load(accountId): Promise<StoredCredentials | null> {
            const { rows } = await pool.query<{ credentials: string | null }>('SELECT credentials FROM mail_accounts WHERE account_id=$1', [
                accountId,
            ]);
            if (!rows[0]) throw new Error('Account not found');
            let sealed = rows[0].credentials;
            if (!sealed) return null;
            const opened = vault.open(sealed, accountId);
            const replace = async (next: string) => {
                const resealed = vault.seal(next, accountId);
                const saved = await swapCredentials(accountId, sealed!, resealed);
                if (saved) sealed = resealed;
                return saved;
            };
            // Sealed with an older key: move it to the current one while it is at hand.
            if (opened.stale) await replace(opened.value);
            return { value: opened.value, replace };
        },
    };

    // Re-encrypts every credential still sealed with an older key or format, in batches. Used when rotating
    // TOKEN_ENCRYPTION_KEY; afterwards TOKEN_ENCRYPTION_KEY_PREVIOUS can be removed.
    async function resealAll(batchSize = 100): Promise<{ resealed: number; failed: number }> {
        let resealed = 0;
        let failed = 0;
        const skip: string[] = [];
        for (;;) {
            const { rows } = await pool.query<{ accountId: string; credentials: string }>(
                `SELECT account_id AS "accountId", credentials FROM mail_accounts
                WHERE credentials IS NOT NULL AND credentials NOT LIKE $1 AND NOT (account_id = ANY($2::uuid[]))
                ORDER BY account_id LIMIT $3`,
                [`v2.${vault.keyId}.%`, skip, batchSize],
            );
            if (!rows.length) return { resealed, failed };
            for (const row of rows) {
                try {
                    const opened = vault.open(row.credentials, row.accountId);
                    if (await swapCredentials(row.accountId, row.credentials, vault.seal(opened.value, row.accountId))) resealed++;
                } catch {
                    // Not readable with any configured key: the account will have to be reconnected.
                    failed++;
                    skip.push(row.accountId);
                }
            }
        }
    }

    return { list, get, upsertConnected, remove, markError, credentialStore, resealAll };
}
export type AccountsRepository = ReturnType<typeof createAccountsRepository>;
