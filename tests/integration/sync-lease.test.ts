import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import type { SyncPage } from '../../src/integrations/mail/types.js';
import { createAccountsRepository } from '../../src/modules/accounts/accounts.repository.js';
import { createEmailRepository } from '../../src/modules/emails/emails.repository.js';
import { createTokenVault } from '../../src/security/token-vault.js';
import { register, startApp, type TestApp } from '../support/harness.js';

let app: TestApp;
before(async () => {
    app = await startApp();
});
beforeEach(() => app.reset());
after(() => app.close());

async function account() {
    const { user } = await register(app, 'sync@example.com');
    const accounts = createAccountsRepository(app.pool, createTokenVault(app.env.TOKEN_ENCRYPTION_KEY));
    return (await accounts.upsertConnected(user.userId, 'gmail', 'sync@gmail.example', 'Sync', '{}')).id;
}
const page = (id: string, cursor: string): SyncPage => ({
    messages: [{ id, fields: { subject: id, receivedAt: new Date().toISOString() } }],
    cursor,
    hasMore: false,
});
const cursorOf = async (id: string) =>
    (await app.pool.query('SELECT sync_cursor, sync_lease_token FROM mail_accounts WHERE account_id=$1', [id])).rows[0];

test('a sync holds no lock or connection while the provider answers, and a second sync waits its turn', async () => {
    const id = await account();
    const emails = createEmailRepository(app.pool);
    let lockedDuringFetch: boolean | undefined;
    let second: SyncPage | null | undefined;
    const first = await emails.syncLocked(id, async cursor => {
        assert.equal(cursor, null);
        const probe = await app.pool.connect();
        try {
            await probe.query('BEGIN');
            await probe.query("SET LOCAL lock_timeout = '200ms'");
            await probe.query('SELECT 1 FROM mail_accounts WHERE account_id=$1 FOR UPDATE', [id]);
            lockedDuringFetch = false;
        } catch {
            lockedDuringFetch = true;
        } finally {
            await probe.query('ROLLBACK');
            probe.release();
        }
        second = await emails.syncLocked(id, async () => assert.fail('the second sync must not fetch'));
        return page('m1', 'cursor-1');
    });
    assert.equal(lockedDuringFetch, false);
    assert.equal(second, null, 'an overlapping sync of the same account is refused');
    assert.equal(first?.cursor, 'cursor-1');
    assert.deepEqual(await cursorOf(id), { sync_cursor: 'cursor-1', sync_lease_token: null }, 'saved and released');
});

test('a failed fetch releases the lease and changes nothing', async () => {
    const id = await account();
    const emails = createEmailRepository(app.pool);
    await assert.rejects(
        emails.syncLocked(id, async () => {
            throw new Error('provider down');
        }),
        /provider down/,
    );
    assert.deepEqual(await cursorOf(id), { sync_cursor: null, sync_lease_token: null });
    assert.ok(await emails.syncLocked(id, async () => page('m1', 'cursor-1')), 'the next sync can start at once');
});

test('a lease that ran out can be taken over, and the slow sync that lost it saves nothing', async () => {
    const id = await account();
    const emails = createEmailRepository(app.pool);
    const slow = emails.syncLocked(id, async () => {
        // Pretend this fetch took longer than the lease: expire it and let another sync finish meanwhile.
        await app.pool.query("UPDATE mail_accounts SET sync_lease_until = NOW() - INTERVAL '1 second' WHERE account_id=$1", [id]);
        assert.ok(await emails.syncLocked(id, async () => page('fresh', 'cursor-fresh')));
        await delay(10);
        return page('stale', 'cursor-stale');
    });
    await assert.rejects(slow, /already syncing/);
    assert.equal((await cursorOf(id)).sync_cursor, 'cursor-fresh');
    const subjects = (await app.pool.query('SELECT subject FROM emails WHERE account_id=$1', [id])).rows.map(row => row.subject);
    assert.deepEqual(subjects, ['fresh']);
});
