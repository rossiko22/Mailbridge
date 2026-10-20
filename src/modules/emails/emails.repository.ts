import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { MailError } from '../../integrations/mail/errors.js';
import { withTransaction } from '../../config/database.js';
import type { MailBody, SyncedMessage, SyncPage } from '../../integrations/mail/types.js';
import { encodeCursor } from './emails.schemas.js';
import { defaultFilters, type MailFilters, PAGE_SIZE } from './emails.types.js';

// Long enough for a slow provider page (50 messages, with quota waits); a crashed sync frees the account after this.
export const SYNC_LEASE_SECONDS = 300;

export type OutgoingAction = 'compose' | 'reply' | 'forward';
export type OutgoingState = 'pending' | 'accepted' | 'failed' | 'unknown';

// Turns what the person typed into two searches: every word as a prefix in subject, sender and text
// ("board pass" -> board:* & pass:*), and the whole text as a substring of subject and sender.
// Words are reduced to letters and digits, so nothing typed can change the meaning of the text-search query;
// in LIKE, %, _ and \ are escaped. Both reach SQL only as parameters.
export function searchTerms(search: string): { like: string; words: string | null } | null {
    const text = search.trim().toLowerCase();
    if (!text) return null;
    const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8).map(word => `${word}:*`);
    return { like: `%${text.replace(/[\\%_]/g, match => `\\${match}`)}%`, words: words.length ? words.join(' & ') : null };
}

// Every query is scoped to accounts owned by the signed-in user; nobody can read another person's mail.
export function createEmailRepository(pool: Pool) {
    async function save(client: PoolClient, accountId: string, message: SyncedMessage) {
        if (message.removed) {
            await client.query('DELETE FROM emails WHERE account_id=$1 AND provider_id=$2', [accountId, message.id]);
            return;
        }
        if (!message.id) throw new Error('Provider message is missing its ID');
        const fields = message.fields;
        // Providers send partial updates: only the keys present may overwrite stored values.
        const present = Object.fromEntries(Object.keys(fields).map(key => [key, true]));
        await client.query(
            `INSERT INTO emails
            (account_id, provider_id, subject, sender_name, sender_address, preview, body_text, received_at, has_attachments, is_read)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (account_id, provider_id) DO UPDATE SET
            subject=CASE WHEN $11::jsonb ? 'subject' THEN EXCLUDED.subject ELSE emails.subject END,
            sender_name=CASE WHEN $11::jsonb ? 'sender' THEN EXCLUDED.sender_name ELSE emails.sender_name END,
            sender_address=CASE WHEN $11::jsonb ? 'sender' THEN EXCLUDED.sender_address ELSE emails.sender_address END,
            preview=CASE WHEN $11::jsonb ? 'preview' THEN EXCLUDED.preview ELSE emails.preview END,
            body_text=CASE WHEN $11::jsonb ? 'bodyText' THEN EXCLUDED.body_text ELSE emails.body_text END,
            received_at=CASE WHEN $11::jsonb ? 'receivedAt' THEN EXCLUDED.received_at ELSE emails.received_at END,
            has_attachments=CASE WHEN $11::jsonb ? 'hasAttachments' THEN EXCLUDED.has_attachments ELSE emails.has_attachments END,
            is_read=CASE WHEN $11::jsonb ? 'isRead' THEN EXCLUDED.is_read ELSE emails.is_read END`,
            [
                accountId,
                message.id,
                fields.subject ?? '',
                fields.sender?.name ?? '',
                fields.sender?.address ?? '',
                fields.preview ?? '',
                fields.bodyText ?? '',
                fields.receivedAt ?? null,
                fields.hasAttachments ?? false,
                fields.isRead ?? false,
                JSON.stringify(present),
            ],
        );
    }

    // Keyset pagination: each page continues after the last row of the previous one, so mail arriving meanwhile
    // never shifts or repeats rows, and a deep page costs the same as the first. Mail without a date counts as the
    // oldest. Each account contributes its next rows straight from the emails_account_order index (LATERAL), and
    // only those few are merged, so "All mail" stays fast however much mail is saved.
    async function list(userId: string, filters: MailFilters = defaultFilters) {
        // Only these fixed SQL fragments vary with the sort; every value is a parameter.
        const order = filters.sort === 'newest' ? 'DESC' : 'ASC';
        const after = filters.sort === 'newest' ? '<' : '>';
        const search = searchTerms(filters.search);
        const result = await pool.query<{ sortKey: string; id: string }>(
            `SELECT e.id, e."accountId", e.subject, e."senderName", e."senderAddress", e.preview, e."receivedAt",
                e."hasAttachments", e."isRead",
                CASE WHEN e."receivedAt" IS NULL THEN '-infinity'
                    ELSE to_char(e."receivedAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') END AS "sortKey"
            FROM mail_accounts a
            CROSS JOIN LATERAL (
                SELECT e.email_id AS id, e.account_id AS "accountId", e.subject, e.sender_name AS "senderName",
                    e.sender_address AS "senderAddress", e.preview, e.received_at AS "receivedAt",
                    e.has_attachments AS "hasAttachments", e.is_read AS "isRead", COALESCE(e.received_at, '-infinity') AS position
                FROM emails e
                WHERE e.account_id = a.account_id
                AND (NOT $3::boolean OR NOT e.is_read)
                AND ($4::text IS NULL
                    OR ($5::text IS NOT NULL AND e.search_vector @@ to_tsquery('simple', $5))
                    OR lower(e.subject || ' ' || e.sender_name || ' ' || e.sender_address) LIKE $4)
                AND ($6::timestamptz IS NULL OR (COALESCE(e.received_at, '-infinity'), e.email_id) ${after} ($6::timestamptz, $7::uuid))
                ORDER BY COALESCE(e.received_at, '-infinity') ${order}, e.email_id ${order}
                LIMIT ${PAGE_SIZE + 1}
            ) e
            WHERE a.user_id = $1 AND ($2::uuid IS NULL OR a.account_id = $2)
            ORDER BY e.position ${order}, e.id ${order}
            LIMIT ${PAGE_SIZE + 1}`,
            [
                userId,
                filters.accountId,
                filters.unreadOnly,
                search?.like ?? null,
                search?.words ?? null,
                filters.after?.key ?? null,
                filters.after?.id ?? null,
            ],
        );
        const rows = result.rows.slice(0, PAGE_SIZE);
        const last = rows.at(-1);
        const hasMore = result.rows.length > PAGE_SIZE;
        return {
            emails: rows.map(({ sortKey: _sortKey, ...email }) => email),
            hasMore,
            nextCursor: hasMore && last ? encodeCursor({ sort: filters.sort, key: last.sortKey, id: last.id }) : null,
        };
    }

    async function get(userId: string, id: string) {
        const result = await pool.query(
            `SELECT e.email_id AS id, e.account_id AS "accountId", e.provider_id AS "providerId", e.subject,
                e.sender_name AS "senderName", e.sender_address AS "senderAddress", e.preview, e.body_text AS body,
                e.received_at AS "receivedAt", e.has_attachments AS "hasAttachments", e.is_read AS "isRead",
                a.email AS "accountEmail", a.provider, a.color AS "accountColor", a.is_demo AS "isDemo"
            FROM emails e JOIN mail_accounts a ON a.account_id = e.account_id WHERE e.email_id = $1 AND a.user_id = $2`,
            [id, userId],
        );
        return result.rows[0] as
            | undefined
            | {
                  id: string;
                  accountId: string;
                  providerId: string;
                  subject: string;
                  senderName: string;
                  senderAddress: string;
                  preview: string;
                  body: string;
                  receivedAt: Date | null;
                  hasAttachments: boolean;
                  isRead: boolean;
                  accountEmail: string;
                  provider: 'outlook' | 'gmail';
                  accountColor: string;
                  isDemo: boolean;
              };
    }

    async function conversation(emailId: string) {
        const result = await pool.query(
            `SELECT action, payload, state, created_at AS "createdAt"
            FROM outgoing_messages WHERE email_id = $1 AND action <> 'compose' ORDER BY created_at DESC LIMIT 50`,
            [emailId],
        );
        return result.rows;
    }

    async function setRead(id: string, isRead: boolean) {
        await pool.query('UPDATE emails SET is_read = $2 WHERE email_id = $1', [id, isRead]);
    }

    // Reserving a request ID makes a retried send harmless: an accepted request is never sent twice.
    async function reserveSend(requestId: string, accountId: string, emailId: string | null, action: OutgoingAction, payload: unknown) {
        const body = JSON.stringify(payload);
        const inserted = await pool.query(
            `INSERT INTO outgoing_messages (request_id, account_id, email_id, action, payload, state)
            VALUES ($1,$2,$3,$4,$5::jsonb,'pending') ON CONFLICT DO NOTHING RETURNING request_id`,
            [requestId, accountId, emailId, action, body],
        );
        if (inserted.rowCount) return true;
        const { rows } = await pool.query(
            `SELECT state, (account_id = $2 AND action = $3 AND payload = $4::jsonb AND email_id IS NOT DISTINCT FROM $5::uuid) AS same
            FROM outgoing_messages WHERE request_id = $1`,
            [requestId, accountId, action, body, emailId],
        );
        if (rows[0]?.same && rows[0].state === 'accepted') return false;
        throw new MailError(
            409,
            'This send request was already submitted. Check your Sent folder in the mail provider before sending again.',
        );
    }

    async function sendState(requestId: string, state: OutgoingState) {
        await pool.query('UPDATE outgoing_messages SET state = $2 WHERE request_id = $1', [requestId, state]);
    }

    // Fetches and stores one sync page. The account is claimed with a lease (one short UPDATE), the provider is asked
    // without holding a database connection, and the page is saved in a short transaction only if the lease is still
    // ours. Returns null when another sync of the same account holds the lease.
    async function syncLocked(accountId: string, fetchPage: (cursor: string | null) => Promise<SyncPage>): Promise<SyncPage | null> {
        const lease = randomUUID();
        const claimed = await pool.query<{ cursor: string | null }>(
            `UPDATE mail_accounts SET sync_lease_token = $2, sync_lease_until = NOW() + make_interval(secs => $3)
            WHERE account_id = $1 AND (sync_lease_until IS NULL OR sync_lease_until < NOW())
            RETURNING sync_cursor AS cursor`,
            [accountId, lease, SYNC_LEASE_SECONDS],
        );
        if (!claimed.rowCount) return null;
        try {
            const page = await fetchPage(claimed.rows[0]!.cursor);
            return await withTransaction(pool, async db => {
                // Taken over after the lease ran out: the other sync's view is newer, so this page is dropped.
                const held = await db.query('SELECT 1 FROM mail_accounts WHERE account_id = $1 AND sync_lease_token = $2 FOR UPDATE', [
                    accountId,
                    lease,
                ]);
                if (!held.rowCount) throw new MailError(409, 'This account is already syncing.');
                for (const message of page.messages) await save(db, accountId, message);
                await db.query(
                    `UPDATE mail_accounts SET sync_cursor = $2, synced_at = NOW(), last_error = NULL, sync_lease_token = NULL, sync_lease_until = NULL
                    WHERE account_id = $1`,
                    [accountId, page.cursor],
                );
                return page;
            });
        } finally {
            // Released here when the fetch or the save failed; a no-op after a successful save.
            await pool.query(
                'UPDATE mail_accounts SET sync_lease_token = NULL, sync_lease_until = NULL WHERE account_id = $1 AND sync_lease_token = $2',
                [accountId, lease],
            );
        }
    }

    async function resetSyncCursor(accountId: string) {
        await pool.query('UPDATE mail_accounts SET sync_cursor = NULL WHERE account_id = $1', [accountId]);
    }

    async function savedBody(emailId: string): Promise<MailBody | undefined> {
        const { rows } = await pool.query<MailBody>('SELECT content_type AS "contentType", content FROM email_bodies WHERE email_id = $1', [
            emailId,
        ]);
        return rows[0];
    }

    async function saveBody(emailId: string, body: MailBody) {
        await pool.query(
            `INSERT INTO email_bodies (email_id, content_type, content) VALUES ($1,$2,$3)
            ON CONFLICT (email_id) DO UPDATE SET content_type = EXCLUDED.content_type, content = EXCLUDED.content, fetched_at = NOW()`,
            [emailId, body.contentType, body.content],
        );
    }

    return { list, get, conversation, setRead, reserveSend, sendState, syncLocked, resetSyncCursor, savedBody, saveBody };
}
export type EmailRepository = ReturnType<typeof createEmailRepository>;
