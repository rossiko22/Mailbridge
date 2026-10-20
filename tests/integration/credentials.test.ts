import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createGmailProvider } from '../../src/integrations/gmail/provider.js';
import { createAccountsRepository } from '../../src/modules/accounts/accounts.repository.js';
import { createTokenVault } from '../../src/security/token-vault.js';
import { register, startApp, type TestApp } from '../support/harness.js';

let app: TestApp;
before(async () => {
    app = await startApp();
});
beforeEach(() => app.reset());
after(() => app.close());

const OLD = 'old-key-0123456789abcdefghijklmnopqrstuv';
const NEW = 'new-key-0123456789abcdefghijklmnopqrstuv';
const credentials = (accessToken: string, expiresAt: number) => JSON.stringify({ refreshToken: 'refresh-1', accessToken, expiresAt });
const storedOf = async (accountId: string) =>
    (await app.pool.query<{ credentials: string }>('SELECT credentials FROM mail_accounts WHERE account_id=$1', [accountId])).rows[0]!
        .credentials;

async function connectWith(key: string, email: string, expiresAt = Date.now() + 3_600_000) {
    const { user } = await register(app, `${email.split('@')[0]}-owner@example.com`);
    const repository = createAccountsRepository(app.pool, createTokenVault(key));
    return (await repository.upsertConnected(user.userId, 'gmail', email, 'Name', credentials('access-1', expiresAt))).id;
}

test('rotating the key: old values are re-encrypted on use and by resealAll, then the old key can go', async () => {
    const used = await connectWith(OLD, 'used@gmail.example');
    const idle = await connectWith(OLD, 'idle@gmail.example');
    const rotating = createAccountsRepository(app.pool, createTokenVault(NEW, OLD));
    const newKeyId = createTokenVault(NEW).keyId;

    // Reading an account during rotation moves it to the new key at once.
    const loaded = await rotating.credentialStore.load(used);
    assert.equal(JSON.parse(loaded!.value).accessToken, 'access-1');
    assert.ok((await storedOf(used)).startsWith(`v2.${newKeyId}.`));
    assert.ok(!(await storedOf(idle)).startsWith(`v2.${newKeyId}.`), 'an account nobody used is still on the old key');

    // The rotation script re-encrypts the rest.
    assert.deepEqual(await rotating.resealAll(), { resealed: 1, failed: 0 });
    assert.deepEqual(await rotating.resealAll(), { resealed: 0, failed: 0 }, 'running it again finds nothing to do');

    // Without the old key everything still opens.
    const afterRotation = createAccountsRepository(app.pool, createTokenVault(NEW));
    for (const id of [used, idle])
        assert.equal(JSON.parse((await afterRotation.credentialStore.load(id))!.value).refreshToken, 'refresh-1');
});

test('resealAll reports values no configured key can read, without stopping', async () => {
    await connectWith('a-forgotten-key-0123456789abcdefghijklm', 'lost@gmail.example');
    await connectWith(OLD, 'kept@gmail.example');
    const rotating = createAccountsRepository(app.pool, createTokenVault(NEW, OLD));
    assert.deepEqual(await rotating.resealAll(), { resealed: 1, failed: 1 });
});

test('saving credentials never overwrites a newer value (compare-and-swap)', async () => {
    const id = await connectWith(NEW, 'swap@gmail.example');
    const store = createAccountsRepository(app.pool, createTokenVault(NEW)).credentialStore;
    const first = (await store.load(id))!;
    const second = (await store.load(id))!;
    assert.equal(await first.replace(credentials('access-from-first', Date.now() + 3_600_000)), true);
    assert.equal(
        await second.replace(credentials('access-from-second', Date.now() + 3_600_000)),
        false,
        'the second writer read an older value',
    );
    assert.equal(JSON.parse((await store.load(id))!.value).accessToken, 'access-from-first');
    assert.equal(await first.replace(credentials('access-again', Date.now() + 3_600_000)), true, 'a writer may update its own last save');
});

test('an expired Google token is renewed once for many concurrent requests, without holding a database lock', async () => {
    const id = await connectWith(NEW, 'renew@gmail.example', Date.now() - 1_000);
    const store = createAccountsRepository(app.pool, createTokenVault(NEW)).credentialStore;
    let renewals = 0;
    let lockedDuringRenewal: boolean | undefined;
    const request: typeof fetch = async (input, init) => {
        const url = new URL(String(input));
        if (url.hostname === 'oauth2.googleapis.com') {
            renewals++;
            // While Google answers, another connection can still lock and update the account row.
            const probe = await app.pool.connect();
            try {
                await probe.query('BEGIN');
                await probe.query("SET LOCAL lock_timeout = '200ms'");
                await probe.query('SELECT 1 FROM mail_accounts WHERE account_id=$1 FOR UPDATE', [id]);
                lockedDuringRenewal = false;
            } catch {
                lockedDuringRenewal = true;
            } finally {
                await probe.query('ROLLBACK');
                probe.release();
            }
            await delay(50);
            return Response.json({ access_token: 'access-2', expires_in: 3600 });
        }
        if (url.hostname === 'gmail.googleapis.com') {
            assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer access-2');
            return Response.json({ emailAddress: 'renew@gmail.example', historyId: '1' });
        }
        throw new Error(`unexpected ${url.href}`);
    };
    const provider = createGmailProvider({ clientId: 'id', clientSecret: 'secret', redirectUri: 'https://x.example/cb' }, store, request);
    const client = provider.client(id);
    // Eight requests at once; the first page of a sync starts with the profile call.
    await Promise.all(Array.from({ length: 8 }, () => client.sync(null).catch(() => undefined)));
    assert.equal(renewals, 1, 'one renewal shared by every concurrent request');
    assert.equal(lockedDuringRenewal, false, 'no row lock is held while Google is asked');
    const saved = JSON.parse((await store.load(id))!.value);
    assert.equal(saved.accessToken, 'access-2');
    assert.equal(saved.refreshToken, 'refresh-1', 'Google did not send a new refresh token, so the old one is kept');
});
