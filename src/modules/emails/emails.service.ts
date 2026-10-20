import type { Pool } from 'pg';
import { MailError } from '../../integrations/mail/errors.js';
import type { MailRegistry } from '../../integrations/mail/registry.js';
import type { NewMessage } from '../../integrations/mail/types.js';
import type { createAccountsRepository } from '../accounts/accounts.repository.js';
import type { EmailRepository, OutgoingAction } from './emails.repository.js';
import type { MailFilters } from './emails.types.js';
import { storedEml } from './eml.js';

type AccountsRepository = ReturnType<typeof createAccountsRepository>;
const demoSend = () => new MailError(400, 'This is a demo mailbox and cannot send mail. Connect a real account to send.');

export function createEmailService(pool: Pool, repository: EmailRepository, accounts: AccountsRepository, registry: MailRegistry) {
    async function accountOf(userId: string, accountId: string) {
        const account = await accounts.get(userId, accountId);
        if (!account) throw new MailError(404, 'Account not found.');
        return account;
    }
    async function emailOf(userId: string, id: string) {
        const email = await repository.get(userId, id);
        if (!email) throw new MailError(404, 'Email not found.');
        return email;
    }
    const clientFor = (email: { accountId: string; provider: 'outlook' | 'gmail'; isDemo: boolean }) => {
        if (email.isDemo) throw new MailError(503, 'This is a demo mailbox with saved messages only.');
        return registry.client({ id: email.accountId, provider: email.provider });
    };

    // One page per call, under a lock so overlapping syncs of the same account cannot interleave.
    async function syncPage(accountId: string, client: ReturnType<MailRegistry['client']>) {
        const db = await pool.connect();
        let open = false;
        try {
            await db.query('BEGIN');
            open = true;
            const lock = await db.query('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [`mail-sync:${accountId}`]);
            if (!lock.rows[0].locked) throw new MailError(409, 'This account is already syncing.');
            const state = await db.query('SELECT sync_cursor FROM mail_accounts WHERE account_id = $1', [accountId]);
            const page = await client.sync(state.rows[0]?.sync_cursor ?? null);
            for (const message of page.messages) await repository.save(db, accountId, message);
            await db.query('UPDATE mail_accounts SET sync_cursor = $2, synced_at = NOW(), last_error = NULL WHERE account_id = $1', [
                accountId,
                page.cursor,
            ]);
            await db.query('COMMIT');
            open = false;
            return {
                processed: page.messages.filter(message => !message.removed).length,
                removed: page.messages.filter(message => message.removed).length,
                hasMore: page.hasMore,
            };
        } catch (error) {
            if (open) await db.query('ROLLBACK');
            throw error;
        } finally {
            db.release();
        }
    }

    async function sync(userId: string, accountId: string) {
        const account = await accountOf(userId, accountId);
        if (account.isDemo) return { processed: 0, removed: 0, hasMore: false };
        const client = registry.client(account);
        try {
            try {
                return await syncPage(account.id, client);
            } catch (error) {
                // An expired checkpoint is rebuilt immediately instead of asking the person to try again.
                if (!(error instanceof MailError) || error.status !== 410) throw error;
                await pool.query('UPDATE mail_accounts SET sync_cursor = NULL WHERE account_id = $1', [account.id]);
                return await syncPage(account.id, client);
            }
        } catch (error) {
            if (error instanceof MailError && error.status === 409) throw error;
            const message = error instanceof MailError ? error.message : 'The mail provider could not be reached. Try again shortly.';
            await accounts.markError(account.id, message, error instanceof MailError && error.reconnect);
            if (error instanceof MailError) throw error;
            throw new MailError(502, message);
        }
    }

    async function setRead(userId: string, id: string, isRead: boolean) {
        const email = await emailOf(userId, id);
        if (email.isRead === isRead) return { isRead };
        if (!email.isDemo) await clientFor(email).setRead(email.providerId, isRead);
        await repository.setRead(id, isRead);
        return { isRead };
    }

    async function body(userId: string, id: string) {
        const email = await emailOf(userId, id);
        const cached = await pool.query('SELECT content_type AS "contentType", content FROM email_bodies WHERE email_id = $1', [id]);
        if (cached.rows[0]) return { ...cached.rows[0], source: 'saved', warning: '' };
        if (email.isDemo) return { contentType: 'text', content: email.body, source: 'saved', warning: '' };
        try {
            const result = await clientFor(email).body(email.providerId);
            await pool.query(
                `INSERT INTO email_bodies (email_id, content_type, content) VALUES ($1,$2,$3)
                ON CONFLICT (email_id) DO UPDATE SET content_type = EXCLUDED.content_type, content = EXCLUDED.content, fetched_at = NOW()`,
                [id, result.contentType, result.content],
            );
            return { ...result, source: 'provider', warning: '' };
        } catch (error) {
            if (!(error instanceof MailError)) throw error;
            if (error.reconnect) await accounts.markError(email.accountId, error.message, true);
            return { contentType: 'text', content: email.body, source: 'fallback', warning: error.message };
        }
    }

    async function exportEmail(userId: string, id: string, original: boolean) {
        const email = await emailOf(userId, id);
        if (!original) return Buffer.from(storedEml(email, email.accountEmail));
        return clientFor(email).mime(email.providerId);
    }
    async function attachments(userId: string, id: string) {
        const email = await emailOf(userId, id);
        if (email.isDemo) return [];
        return clientFor(email).attachments(email.providerId);
    }
    async function attachment(userId: string, id: string, attachmentId: string) {
        const email = await emailOf(userId, id);
        return clientFor(email).attachment(email.providerId, attachmentId);
    }

    // The provider may accept a message and then fail to answer; "unknown" tells the person not to blindly resend.
    async function deliver(requestId: string, send: () => Promise<void>) {
        try {
            await send();
        } catch (error) {
            await repository.sendState(requestId, error instanceof MailError ? 'failed' : 'unknown');
            if (error instanceof MailError) throw error;
            throw new MailError(
                502,
                'The result of sending is uncertain. Check your Sent folder before trying again to avoid a duplicate.',
            );
        }
        try {
            await repository.sendState(requestId, 'accepted');
        } catch {
            throw new MailError(
                502,
                'The provider accepted the message, but history could not be updated. Check your Sent folder; do not resend.',
            );
        }
    }

    async function reply(
        userId: string,
        id: string,
        requestId: string,
        action: Exclude<OutgoingAction, 'compose'>,
        comment: string,
        recipients: string[],
    ) {
        const email = await emailOf(userId, id);
        if (email.isDemo) throw demoSend();
        const client = clientFor(email);
        if (!(await repository.reserveSend(requestId, email.accountId, email.id, action, { comment, recipients })))
            return { accepted: true };
        await deliver(requestId, () => client.send(email.providerId, action, comment, recipients));
        return { accepted: true };
    }

    async function compose(userId: string, accountId: string, requestId: string, message: NewMessage) {
        const account = await accountOf(userId, accountId);
        if (account.isDemo) throw demoSend();
        const client = registry.client(account);
        if (!(await repository.reserveSend(requestId, account.id, null, 'compose', message))) return { accepted: true };
        await deliver(requestId, () => client.compose(message));
        return { accepted: true };
    }

    return {
        sync,
        setRead,
        body,
        exportEmail,
        attachments,
        attachment,
        reply,
        compose,
        list: (userId: string, filters: MailFilters) => repository.list(userId, filters),
        async get(userId: string, id: string) {
            const email = await emailOf(userId, id);
            const { providerId, ...safe } = email;
            return { ...safe, conversation: await repository.conversation(id) };
        },
    };
}
export type EmailService = ReturnType<typeof createEmailService>;
