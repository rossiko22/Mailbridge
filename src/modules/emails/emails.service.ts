import type { Pool } from 'pg';
import { GraphError, type createGraphClient, type NewMessage } from '../../integrations/outlook/graph.js';
import type { createEmailRepository } from './emails.repository.js';
import type { MailAccess, MailFilters } from './emails.types.js';
import { storedEml } from './eml.js';

export function createEmailService(pool: Pool, repository: ReturnType<typeof createEmailRepository>,
    graph: (Pick<ReturnType<typeof createGraphClient>, 'page'> & Partial<ReturnType<typeof createGraphClient>>) | undefined, mailbox: string) {
    function requireOutlook() { if (!graph) throw new GraphError(503, 'Outlook is not configured. Local ticket actions and text exports are available. Configure GRAPH_* to use Outlook.'); return graph; }
    async function sync() {
        const outlook = requireOutlook();
        const client = await pool.connect();
        let transactionActive = false;
        try {
            await client.query('BEGIN');
            transactionActive = true;
            // Transaction-scoped lock prevents concurrent syncs across server processes.
            const lock = await client.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [`mail-sync:${mailbox}`]);
            if (!lock.rows[0].locked) throw new GraphError(409, 'Mailbox synchronization is already running.');
            await client.query('INSERT INTO mailbox_sync (mailbox) VALUES ($1) ON CONFLICT DO NOTHING', [mailbox]);
            const state = await client.query('SELECT cursor FROM mailbox_sync WHERE mailbox=$1', [mailbox]);
            let page;
            try { page = await outlook.page(state.rows[0].cursor); }
            catch (error) {
                if (!(error instanceof GraphError) || error.status !== 410) throw error;
                await client.query('UPDATE mailbox_sync SET cursor=NULL WHERE mailbox=$1', [mailbox]);
                await client.query('COMMIT');
                transactionActive = false;
                throw error;
            }
            for (const message of page.value) await repository.save(client, mailbox, message);
            await client.query('UPDATE mailbox_sync SET cursor=$2, synced_at=NOW() WHERE mailbox=$1',
                [mailbox, page['@odata.nextLink'] || page['@odata.deltaLink']]);
            await client.query('COMMIT');
            transactionActive = false;
            return { processed: page.value.filter(message => !message['@removed']).length, hasMore: Boolean(page['@odata.nextLink']) };
        } catch (error) {
            if (transactionActive) await client.query('ROLLBACK');
            throw error;
        } finally { client.release(); }
    }
    async function send(id: string, access: MailAccess, requestId: string, action: 'reply' | 'forward', comment: string, recipients: string[]) {
        const email = await repository.get(mailbox, id, access);
        if (!email) throw new GraphError(404, 'Email not found.');
        if (!graph?.send) throw new GraphError(503, 'Sending is not configured.');
        if (!await repository.reserveSend(id, access, requestId, action, comment, recipients)) return { accepted: true };
        try { await graph.send(email.graphId, action, comment, recipients); }
        catch (error) {
            await repository.sendState(requestId, error instanceof GraphError ? 'failed' : 'unknown');
            if (error instanceof GraphError) throw error;
            throw new GraphError(502, 'Sending result is uncertain. Check Outlook Sent Items before trying again to avoid a duplicate.');
        }
        try { await repository.sendState(requestId, 'accepted'); }
        catch { throw new GraphError(502, 'Outlook accepted the message, but its history could not be updated. Check Sent Items; do not resend.'); }
        return { accepted: true };
    }
    async function compose(access: MailAccess, requestId: string, message: NewMessage) {
        if (!access.manage) throw new GraphError(403, 'Only the mailbox owner can start a new conversation.');
        if (!graph?.compose) throw new GraphError(503, 'Sending is not configured.');
        if (!await repository.reserveCompose(mailbox, access, requestId, message)) return { accepted: true };
        try { await graph.compose(message); }
        catch (error) {
            await repository.composeState(requestId, error instanceof GraphError ? 'failed' : 'unknown');
            if (error instanceof GraphError) throw error;
            throw new GraphError(502, 'Sending result is uncertain. Check Outlook Sent Items before trying again.');
        }
        try { await repository.composeState(requestId, 'accepted'); }
        catch { throw new GraphError(502, 'Outlook accepted the message, but history could not be updated. Check Sent Items; do not resend.'); }
        return { accepted: true };
    }
    async function accessible(id: string, access: MailAccess) {
        const email = await repository.get(mailbox, id, access);
        if (!email) throw new GraphError(404, 'Email not found.');
        return email;
    }
    async function exportEmail(id: string, access: MailAccess, original = false) {
        const email = await accessible(id, access);
        if (!original) return Buffer.from(storedEml(email, mailbox));
        const outlook = requireOutlook();
        if (!outlook.mime) throw new GraphError(503, 'Original MIME export is not configured.');
        return outlook.mime(email.graphId);
    }
    async function attachments(id: string, access: MailAccess) {
        const email = await accessible(id, access);
        const outlook = requireOutlook();
        if (!outlook.attachments) throw new GraphError(503, 'Attachments are not configured.');
        return outlook.attachments(email.graphId);
    }
    async function attachment(id: string, attachmentId: string, access: MailAccess) {
        const email = await accessible(id, access);
        const outlook = requireOutlook();
        if (!outlook.attachment) throw new GraphError(503, 'Attachments are not configured.');
        return outlook.attachment(email.graphId, attachmentId);
    }
    async function body(id: string, access: MailAccess) {
        const email = await accessible(id, access);
        const cached = await pool.query('SELECT content_type AS "contentType",content FROM email_bodies WHERE email_id=$1', [id]);
        if (cached.rows[0]) return { ...cached.rows[0], source: 'saved', warning: '' };
        try {
            const outlook = requireOutlook();
            if (!outlook.body) throw new GraphError(503, 'Formatted messages are not configured.');
            const result = await outlook.body(email.graphId);
            await pool.query(`INSERT INTO email_bodies(email_id,content_type,content) VALUES($1,$2,$3)
                ON CONFLICT (email_id) DO UPDATE SET content_type=EXCLUDED.content_type,content=EXCLUDED.content,fetched_at=NOW()`,
                [id,result.contentType.toLowerCase(),result.content]);
            return { ...result, source: 'outlook', warning: '' };
        } catch (error) {
            if (!(error instanceof GraphError)) throw error;
            return { contentType: 'text', content: email.body, source: 'fallback', warning: error.message };
        }
    }
    return { sync, send, compose, exportEmail, attachments, attachment, body,
        outgoing: (access: MailAccess) => repository.outgoing(mailbox, access),
        list: (offset: number, filters?: MailFilters, access?: MailAccess) => repository.list(mailbox, offset, filters, access),
        get: (id: string, access?: MailAccess) => repository.get(mailbox, id, access),
        metadata: async (access: MailAccess) => ({ ...await repository.metadata(mailbox, access), outlookConfigured: Boolean(graph) }),
        transition: (id: string, access: MailAccess, version: number, action: string, assignee?: string | null) => repository.transition(mailbox, id, access, version, action, assignee) };
}
