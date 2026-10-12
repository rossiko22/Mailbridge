import type { Pool, PoolClient } from 'pg';
import { MailError } from '../../integrations/mail/errors.js';
import type { SyncedMessage } from '../../integrations/mail/types.js';
import { defaultFilters, PAGE_SIZE, type MailFilters } from './emails.types.js';

export type OutgoingAction = 'compose' | 'reply' | 'forward';
export type OutgoingState = 'pending' | 'accepted' | 'failed' | 'unknown';

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
        await client.query(`INSERT INTO emails
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
            [accountId, message.id, fields.subject ?? '', fields.sender?.name ?? '', fields.sender?.address ?? '', fields.preview ?? '',
                fields.bodyText ?? '', fields.receivedAt ?? null, fields.hasAttachments ?? false, fields.isRead ?? false, JSON.stringify(present)]);
    }

    async function list(userId: string, filters: MailFilters = defaultFilters) {
        const direction = filters.sort === 'oldest' ? 'ASC' : 'DESC';
        const result = await pool.query(`SELECT e.email_id AS id, e.account_id AS "accountId", e.subject, e.sender_name AS "senderName",
                e.sender_address AS "senderAddress", e.preview, e.received_at AS "receivedAt", e.has_attachments AS "hasAttachments", e.is_read AS "isRead"
            FROM emails e JOIN mail_accounts a ON a.account_id = e.account_id
            WHERE a.user_id = $1
            AND ($2::uuid IS NULL OR e.account_id = $2)
            AND (NOT $3::boolean OR NOT e.is_read)
            AND ($4 = '' OR strpos(lower(e.subject || ' ' || e.sender_name || ' ' || e.sender_address || ' ' || e.body_text), lower($4)) > 0)
            ORDER BY e.received_at ${direction} NULLS LAST, e.email_id LIMIT ${PAGE_SIZE + 1} OFFSET $5`,
            [userId, filters.accountId, filters.unreadOnly, filters.search, filters.offset]);
        return { emails: result.rows.slice(0, PAGE_SIZE), hasMore: result.rows.length > PAGE_SIZE };
    }

    async function get(userId: string, id: string) {
        const result = await pool.query(`SELECT e.email_id AS id, e.account_id AS "accountId", e.provider_id AS "providerId", e.subject,
                e.sender_name AS "senderName", e.sender_address AS "senderAddress", e.preview, e.body_text AS body,
                e.received_at AS "receivedAt", e.has_attachments AS "hasAttachments", e.is_read AS "isRead",
                a.email AS "accountEmail", a.provider, a.color AS "accountColor", a.is_demo AS "isDemo"
            FROM emails e JOIN mail_accounts a ON a.account_id = e.account_id WHERE e.email_id = $1 AND a.user_id = $2`, [id, userId]);
        return result.rows[0] as undefined | {
            id: string; accountId: string; providerId: string; subject: string; senderName: string; senderAddress: string; preview: string;
            body: string; receivedAt: Date | null; hasAttachments: boolean; isRead: boolean;
            accountEmail: string; provider: 'outlook' | 'gmail'; accountColor: string; isDemo: boolean;
        };
    }

    async function conversation(emailId: string) {
        const result = await pool.query(`SELECT action, payload, state, created_at AS "createdAt"
            FROM outgoing_messages WHERE email_id = $1 AND action <> 'compose' ORDER BY created_at DESC LIMIT 50`, [emailId]);
        return result.rows;
    }

    async function setRead(id: string, isRead: boolean) {
        await pool.query('UPDATE emails SET is_read = $2 WHERE email_id = $1', [id, isRead]);
    }

    // Reserving a request ID makes a retried send harmless: an accepted request is never sent twice.
    async function reserveSend(requestId: string, accountId: string, emailId: string | null, action: OutgoingAction, payload: unknown) {
        const body = JSON.stringify(payload);
        const inserted = await pool.query(`INSERT INTO outgoing_messages (request_id, account_id, email_id, action, payload, state)
            VALUES ($1,$2,$3,$4,$5::jsonb,'pending') ON CONFLICT DO NOTHING RETURNING request_id`, [requestId, accountId, emailId, action, body]);
        if (inserted.rowCount) return true;
        const { rows } = await pool.query(`SELECT state, (account_id = $2 AND action = $3 AND payload = $4::jsonb AND email_id IS NOT DISTINCT FROM $5::uuid) AS same
            FROM outgoing_messages WHERE request_id = $1`, [requestId, accountId, action, body, emailId]);
        if (rows[0]?.same && rows[0].state === 'accepted') return false;
        throw new MailError(409, 'This send request was already submitted. Check your Sent folder in the mail provider before sending again.');
    }

    async function sendState(requestId: string, state: OutgoingState) {
        await pool.query('UPDATE outgoing_messages SET state = $2 WHERE request_id = $1', [requestId, state]);
    }

    return { save, list, get, conversation, setRead, reserveSend, sendState };
}
export type EmailRepository = ReturnType<typeof createEmailRepository>;
