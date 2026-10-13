import type { Request } from 'express';
import type { Pool } from 'pg';

export const AUDIT_RETENTION_DAYS = 90;

export type AuditOutcome = 'success' | 'failure' | 'denied';
export type AuditEvent = 'sign-in' | 'sign-out' | 'register' | 'password-change' | 'password-reset-request' | 'password-reset'
    | 'account-connect' | 'account-remove' | 'mail-send' | 'mail-export' | 'attachment-download' | 'request-refused';

export interface AuditOptions {
    // Who the event is about. Defaults to the account matching `email`, then to the signed-in user.
    userId?: string | undefined;
    email?: string | undefined;
    target?: string | undefined;
    // Small facts only. Never mail content, passwords or tokens.
    detail?: Record<string, string | number | boolean>;
}
export interface AuditEntry { id: string; occurredAt: Date; event: AuditEvent; outcome: AuditOutcome; ip: string | null; userAgent: string; detail: Record<string, string | number | boolean> }

// A durable record of security-relevant actions, kept for 90 days.
export function createAudit(pool: Pool, now: () => number = Date.now) {
    let pruned = 0;

    // Never throws: a failed audit write must not break the request it describes.
    async function record(req: Request, event: AuditEvent, outcome: AuditOutcome, options: AuditOptions = {}): Promise<void> {
        try {
            const session = req.session as Request['session'] | undefined;
            await pool.query(`INSERT INTO audit_events (user_id, event, outcome, ip, user_agent, request_id, target, detail)
                VALUES (COALESCE($1::uuid, (SELECT user_id FROM users WHERE $2 <> '' AND lower(email) = lower($2)), $3::uuid), $4, $5, $6, $7, $8, $9, $10::jsonb)`,
                [options.userId ?? null, (options.email ?? '').trim().slice(0, 254), session?.userId ?? null, event, outcome, req.ip ?? null,
                    (req.get('user-agent') ?? '').slice(0, 300), req.res?.locals.requestId ?? null, options.target?.slice(0, 100) ?? null, JSON.stringify(options.detail ?? {})]);
            if (now() - pruned > 3_600_000) {
                pruned = now();
                await pool.query('DELETE FROM audit_events WHERE occurred_at < NOW() - make_interval(days => $1)', [AUDIT_RETENTION_DAYS]);
            }
        } catch (error) {
            console.error(JSON.stringify({ event: 'audit-write-failed', audit: event, name: error instanceof Error ? error.name : 'Unknown' }));
        }
    }

    // What a person may see about their own account.
    async function recent(userId: string, limit = 50): Promise<AuditEntry[]> {
        const { rows } = await pool.query<AuditEntry>(`SELECT event_id::text AS id, occurred_at AS "occurredAt", event, outcome,
                regexp_replace(host(ip), '^::ffff:', '') AS ip, user_agent AS "userAgent", detail
            FROM audit_events WHERE user_id = $1 ORDER BY occurred_at DESC, event_id DESC LIMIT $2`, [userId, limit]);
        return rows;
    }

    return { record, recent };
}
export type Audit = ReturnType<typeof createAudit>;

export const noAudit: Audit = { record: async () => {}, recent: async () => [] };
