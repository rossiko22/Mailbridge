import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemoData } from '../../src/scripts/demo-data.js';
import { createClient, PASSWORD, register, startApp, type TestApp, type TestClient } from '../support/harness.js';

let app: TestApp;
before(async () => {
    app = await startApp();
});
beforeEach(() => app.reset());
after(() => app.close());

interface Entry {
    event: string;
    outcome: string;
    ip: string | null;
    userAgent: string;
    detail: Record<string, unknown>;
}
const activity = async (client: TestClient) => ((await (await client.get('/auth/activity')).json()) as { events: Entry[] }).events;
const summary = (events: Entry[]) => events.map(item => `${item.event}:${item.outcome}`);
const stored = async () =>
    (await app.pool.query('SELECT user_id, event, outcome, detail, target FROM audit_events ORDER BY event_id')).rows;
// Refused requests are recorded after the response has gone out.
async function eventually<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    for (let attempt = 0; ; attempt++) {
        const value = await read();
        if (done(value) || attempt > 40) return value;
        await delay(25);
    }
}

test('sign-ins, failures and sign-outs are recorded with where they came from', async () => {
    const { client, user } = await register(app, 'person@example.com');
    await client.post('/auth/logout');
    const browser = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36' };
    await createClient(app.url).post('/auth/login', { email: 'PERSON@example.com', password: 'wrong-password-123' }, browser);
    await client.post('/auth/login', { email: 'person@example.com', password: PASSWORD }, browser);

    const events = await activity(client);
    assert.deepEqual(summary(events), ['sign-in:success', 'sign-in:failure', 'sign-out:success', 'register:success']);
    assert.equal(events[0]!.ip, '127.0.0.1');
    assert.match(events[0]!.userAgent, /Chrome\/140/);
    assert.ok((await stored()).every(row => row.user_id === user.userId));
});
test('an attempt on an unknown address is kept without storing the address', async () => {
    await createClient(app.url).post('/auth/login', { email: 'nobody@example.com', password: 'guess-guess-guess' });
    await createClient(app.url).post('/auth/forgot', { email: 'nobody@example.com' });
    const rows = await stored();
    assert.deepEqual(
        rows.map(row => [row.event, row.outcome, row.user_id]),
        [
            ['sign-in', 'failure', null],
            ['password-reset-request', 'success', null],
        ],
    );
    assert.ok(!JSON.stringify(rows).includes('nobody@example.com'));
});
test('password changes and resets appear in the history of the account they affect', async () => {
    const { client } = await register(app, 'person@example.com');
    await client.post('/auth/password', { currentPassword: 'not-the-password', newPassword: 'a-brand-new-password' });
    await client.post('/auth/password', { currentPassword: PASSWORD, newPassword: 'a-brand-new-password' });
    await createClient(app.url).post('/auth/reset', { token: 'x'.repeat(43), password: 'another-new-password' });

    const again = createClient(app.url);
    await again.post('/auth/login', { email: 'person@example.com', password: 'a-brand-new-password' });
    assert.deepEqual(summary(await activity(again)), [
        'sign-in:success',
        'password-change:success',
        'password-change:failure',
        'register:success',
    ]);
    const rows = await stored();
    assert.deepEqual(
        rows.filter(row => row.event === 'password-reset').map(row => [row.outcome, row.user_id]),
        [['failure', null]],
    );
    assert.ok(!/password"|a-brand-new|not-the-password|correct-horse/.test(JSON.stringify(rows)), 'no password ever reaches the audit log');
});
test('throttled sign-ins and cross-site requests are recorded as refused', async () => {
    const { client } = await register(app, 'target@example.com');
    for (let attempt = 0; attempt < 11; attempt++)
        await createClient(app.url).post('/auth/login', { email: 'target@example.com', password: 'wrong-password-123' });
    await createClient(app.url).post('/auth/login', { email: 'a@example.com', password: 'x' }, { Origin: 'https://evil.example' });

    const refused = await eventually(
        async () => (await stored()).filter(row => row.event === 'request-refused'),
        rows => rows.length >= 2,
    );
    assert.deepEqual(
        refused.map(row => [row.outcome, row.detail.status, row.detail.path]),
        [
            ['denied', 429, '/auth/login'],
            ['denied', 415, '/auth/login'],
        ],
    );
    const mine = await activity(client);
    assert.ok(
        mine.some(item => item.event === 'request-refused' && item.detail.status === 429),
        'the account owner can see the lockout',
    );
    assert.equal(mine.filter(item => item.event === 'sign-in' && item.outcome === 'failure').length, 10);
});
test('mailbox changes, exports and send attempts are recorded without any mail content', async () => {
    await seedDemoData(app.pool);
    const client = createClient(app.url);
    await client.post('/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD });
    const { accounts } = (await (await client.get('/accounts')).json()) as { accounts: Array<{ id: string; email: string }> };
    const { emails } = (await (await client.get('/emails')).json()) as { emails: Array<{ id: string }> };

    await client.get(`/emails/${emails[0]!.id}/export`);
    await client.post('/emails/compose', {
        accountId: accounts[0]!.id,
        requestId: randomUUID(),
        subject: 'Quarterly numbers',
        body: 'Strictly confidential text',
        to: ['bob@example.com', 'carol@example.com'],
    });
    await client.delete(`/accounts/${accounts[1]!.id}`);

    const events = await activity(client);
    assert.deepEqual(summary(events), ['account-remove:success', 'mail-send:failure', 'mail-export:success', 'sign-in:success']);
    assert.deepEqual(events[0]!.detail, { provider: 'gmail', email: 'demo.personal@gmail.example' });
    assert.deepEqual(events[1]!.detail, { action: 'compose', recipients: 2, status: 400 });
    assert.ok(!/Quarterly|confidential|bob@example\.com/.test(JSON.stringify(await stored())));
});
test('connecting a mailbox is recorded, including a forged callback', async () => {
    const { client } = await register(app, 'person@example.com');
    const state = new URL((await client.get('/accounts/connect/gmail')).headers.get('location')!).searchParams.get('state')!;
    await client.get(`/accounts/callback/gmail?state=${'x'.repeat(state.length)}&code=abc`);
    const next = new URL((await client.get('/accounts/connect/gmail')).headers.get('location')!).searchParams.get('state');
    app.setUpstream(url => {
        if (url.hostname === 'oauth2.googleapis.com')
            return Response.json({
                access_token: 'access-secret',
                refresh_token: 'refresh-secret',
                expires_in: 3600,
                scope: 'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
            });
        if (url.hostname === 'openidconnect.googleapis.com') return Response.json({ email: 'real@gmail.example', name: 'Real' });
        return undefined;
    });
    await client.get(`/accounts/callback/gmail?state=${next}&code=auth-code`);

    const events = (await activity(client)).filter(item => item.event === 'account-connect');
    assert.deepEqual(
        events.map(item => [item.outcome, item.detail.reason ?? item.detail.email]),
        [
            ['success', 'real@gmail.example'],
            ['denied', 'invalid-state'],
        ],
    );
    assert.ok(!/secret|auth-code/.test(JSON.stringify(await stored())), 'no token or code reaches the audit log');
});
test('activity is private to its owner and needs a session', async () => {
    const { client: first } = await register(app, 'first@example.com');
    const { client: second } = await register(app, 'second@example.com');
    await first.post('/auth/password', { currentPassword: 'not-the-password', newPassword: 'a-brand-new-password' });
    assert.deepEqual(summary(await activity(second)), ['register:success']);
    assert.equal((await createClient(app.url).get('/auth/activity')).status, 401);
});
test('events older than the retention period are removed', async () => {
    const { client, user } = await register(app, 'person@example.com');
    await app.pool.query(
        "INSERT INTO audit_events (user_id, event, outcome, occurred_at) VALUES ($1, 'sign-in', 'success', NOW() - INTERVAL '91 days'), ($1, 'sign-out', 'success', NOW() - INTERVAL '89 days')",
        [user.userId],
    );
    const { createAudit } = await import('../../src/modules/audit/audit.js');
    await createAudit(app.pool).record({ get: () => undefined, session: { userId: user.userId } } as never, 'sign-in', 'success');
    assert.deepEqual(summary(await activity(client)), ['sign-in:success', 'register:success', 'sign-out:success']);
});
test('deleting a user removes their history', async () => {
    const { user } = await register(app, 'person@example.com');
    await app.pool.query('DELETE FROM users WHERE user_id = $1', [user.userId]);
    assert.equal((await stored()).length, 0);
});
