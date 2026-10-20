import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createAccountsRepository } from '../../src/modules/accounts/accounts.repository.js';
import { DEMO_EMAIL, DEMO_PASSWORD, seedDemoData } from '../../src/scripts/demo-data.js';
import { type ApiError, createClient, register, startApp, type TestApp, type TestClient } from '../support/harness.js';

let app: TestApp;
before(async () => {
    app = await startApp();
});
beforeEach(() => app.reset());
after(() => app.close());

interface Account {
    id: string;
    provider: string;
    email: string;
    total: number;
    unread: number;
    isDemo: boolean;
    needsReconnect: boolean;
    lastError: string | null;
}
interface Mail {
    id: string;
    accountId: string;
    subject: string;
    isRead: boolean;
}

async function demo() {
    await seedDemoData(app.pool);
    const client = createClient(app.url);
    assert.equal((await client.post('/auth/login', { email: DEMO_EMAIL, password: DEMO_PASSWORD })).status, 200);
    return client;
}
const accountsOf = async (client: TestClient) =>
    (await (await client.get('/accounts')).json()) as { accounts: Account[]; providers: Record<string, boolean> };
const mailOf = async (client: TestClient, query = '') =>
    (await (await client.get(`/emails${query}`)).json()) as { emails: Mail[]; hasMore: boolean };

// A Gmail account whose stored sign-in is still valid, so no token refresh is needed.
async function connectGmail(userId: string, email = 'real@gmail.example') {
    const accounts = createAccountsRepository(app.pool, app.env.TOKEN_ENCRYPTION_KEY);
    const saved = await accounts.upsertConnected(
        userId,
        'gmail',
        email,
        'Real',
        JSON.stringify({ refreshToken: 'refresh-secret', accessToken: 'access-secret', expiresAt: Date.now() + 3_600_000 }),
    );
    return saved.id;
}
const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const gmailMessage = (id: string, labels = ['INBOX', 'UNREAD']) => ({
    id,
    threadId: `t-${id}`,
    labelIds: labels,
    snippet: `Preview of ${id}`,
    internalDate: String(Date.now()),
    payload: {
        mimeType: 'text/plain',
        headers: [
            { name: 'Subject', value: `Subject ${id}` },
            { name: 'From', value: 'Ann <ann@example.com>' },
            { name: 'Message-ID', value: `<${id}@mail.example>` },
        ],
        body: { data: Buffer.from(`Body of ${id}`).toString('base64url') },
    },
});

test('the combined inbox lists every mailbox and can be filtered, searched and sorted', async () => {
    const client = await demo();
    const { accounts, providers } = await accountsOf(client);
    assert.deepEqual(
        accounts.map(item => [item.provider, item.total, item.unread, item.isDemo]),
        [
            ['outlook', 7, 3, true],
            ['gmail', 6, 3, true],
        ],
    );
    assert.deepEqual(providers, { outlook: false, gmail: true });

    const all = await mailOf(client);
    assert.equal(all.emails.length, 13);
    assert.equal(all.hasMore, false);
    assert.equal(all.emails[0]!.subject, 'Q4 roadmap review — slides attached');
    assert.equal((await mailOf(client, '?sort=oldest')).emails[0]!.subject, 'Welcome aboard!');
    assert.equal((await mailOf(client, '?unread=true')).emails.length, 6);
    const gmail = accounts[1]!;
    const onlyGmail = await mailOf(client, `?account=${gmail.id}`);
    assert.equal(onlyGmail.emails.length, 6);
    assert.ok(onlyGmail.emails.every(item => item.accountId === gmail.id));
    assert.deepEqual(
        (await mailOf(client, '?search=BOARDING')).emails.map(item => item.subject),
        ['Your boarding pass for flight NW 214'],
    );
    assert.equal((await mailOf(client, '?search=%25')).emails.length, 0, 'search text is matched literally, not as a pattern');
});
test('a message opens in a sandboxed frame, exports as .eml and can be marked read', async () => {
    const client = await demo();
    const target = (await mailOf(client, '?search=roadmap')).emails[0]!;
    const detail = (await (await client.get(`/emails/${target.id}`)).json()) as { email: Record<string, unknown> };
    assert.equal(detail.email.senderAddress, 'priya.nair@contoso.example');
    assert.ok(!('providerId' in detail.email));

    const body = await client.get(`/emails/${target.id}/body`);
    assert.equal(body.status, 200);
    assert.match(body.headers.get('content-type') ?? '', /text\/html/);
    const csp = body.headers.get('content-security-policy') ?? '';
    assert.ok(csp.includes("default-src 'none'") && !csp.includes("script-src 'self'"), 'mail bodies may not run scripts');
    assert.match(await body.text(), /roadmap deck/);

    const eml = await client.get(`/emails/${target.id}/export`);
    assert.match(eml.headers.get('content-type') ?? '', /message\/rfc822/);
    assert.match(eml.headers.get('content-disposition') ?? '', /^attachment; filename="mail-.*-text\.eml"$/);
    assert.match(await eml.text(), /^From: .*<priya\.nair@contoso\.example>/);

    assert.deepEqual(await (await client.patch(`/emails/${target.id}/read`, { isRead: true })).json(), { isRead: true });
    assert.equal((await accountsOf(client)).accounts[0]!.unread, 2);
    assert.equal((await client.patch(`/emails/${target.id}/read`, { isRead: 'yes' })).status, 400);
});
test('demo mailboxes are read-only: nothing is sent or synced', async () => {
    const client = await demo();
    const { accounts } = await accountsOf(client);
    const target = (await mailOf(client)).emails[0]!;
    assert.deepEqual(await (await client.post(`/accounts/${accounts[0]!.id}/sync`)).json(), { processed: 0, removed: 0, hasMore: false });
    const reply = await client.post(`/emails/${target.id}/send`, { action: 'reply', requestId: randomUUID(), comment: 'Hello' });
    const compose = await client.post('/emails/compose', {
        accountId: accounts[0]!.id,
        requestId: randomUUID(),
        subject: 'Hi',
        body: 'Text',
        to: ['a@example.com'],
    });
    for (const response of [reply, compose]) {
        assert.equal(response.status, 400);
        assert.match(((await response.json()) as ApiError).error.message, /demo mailbox/);
    }
    assert.equal((await app.pool.query('SELECT 1 FROM outgoing_messages')).rowCount, 0);
});
test("one person can never read or change another person's mail or accounts", async () => {
    const owner = await demo();
    const { accounts } = await accountsOf(owner);
    const target = (await mailOf(owner)).emails[0]!;
    const { client: intruder } = await register(app, 'intruder@example.com');

    assert.deepEqual(await mailOf(intruder), { emails: [], hasMore: false });
    assert.deepEqual((await accountsOf(intruder)).accounts, []);
    assert.equal((await mailOf(intruder, `?account=${accounts[0]!.id}`)).emails.length, 0);
    for (const path of ['', '/body', '/export', '/attachments'])
        assert.equal((await intruder.get(`/emails/${target.id}${path}`)).status, 404, path);
    assert.equal((await intruder.patch(`/emails/${target.id}/read`, { isRead: true })).status, 404);
    assert.equal(
        (await intruder.post(`/emails/${target.id}/send`, { action: 'reply', requestId: randomUUID(), comment: 'Hello' })).status,
        404,
    );
    assert.equal(
        (
            await intruder.post('/emails/compose', {
                accountId: accounts[0]!.id,
                requestId: randomUUID(),
                subject: 'Hi',
                body: 'Text',
                to: ['a@example.com'],
            })
        ).status,
        404,
    );
    assert.equal((await intruder.post(`/accounts/${accounts[0]!.id}/sync`)).status, 404);
    assert.equal((await intruder.delete(`/accounts/${accounts[0]!.id}`)).status, 404);

    assert.equal((await mailOf(owner)).emails.length, 13);
    assert.equal((await mailOf(owner)).emails.find(item => item.id === target.id)!.isRead, false);
});
test('removing an account removes its mail and leaves the others alone', async () => {
    const client = await demo();
    const { accounts } = await accountsOf(client);
    assert.equal((await client.delete(`/accounts/${accounts[1]!.id}`)).status, 200);
    assert.equal((await mailOf(client)).emails.length, 7);
    assert.equal((await client.delete(`/accounts/${accounts[1]!.id}`)).status, 404);
});
test('compose and reply input is validated before anything is stored', async () => {
    const client = await demo();
    const { accounts } = await accountsOf(client);
    const valid = { accountId: accounts[0]!.id, requestId: randomUUID(), subject: 'Hi', body: 'Text', to: ['a@example.com'] };
    for (const change of [
        { to: [] },
        { to: ['not-an-address'] },
        { subject: 'Injected\r\nBcc: x@example.com' },
        { requestId: 'nope' },
        { body: '   ' },
        { to: Array.from({ length: 21 }, (_item, index) => `p${index}@example.com`) },
    ]) {
        assert.equal((await client.post('/emails/compose', { ...valid, ...change })).status, 400, JSON.stringify(change).slice(0, 60));
    }
});

test('connecting Gmail starts an OAuth flow with PKCE and a single-use state', async () => {
    const { client } = await register(app, 'person@example.com');
    const started = await client.get('/accounts/connect/gmail');
    assert.equal(started.status, 302);
    const target = new URL(started.headers.get('location')!);
    assert.equal(target.origin, 'https://accounts.google.com');
    assert.equal(target.searchParams.get('client_id'), 'test-client-id');
    assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(target.searchParams.get('redirect_uri'), `${app.env.PUBLIC_ORIGIN}/accounts/callback/gmail`);
    assert.ok(target.searchParams.get('code_challenge'));
    const state = target.searchParams.get('state')!;
    assert.ok(state.length >= 20);

    const forged = await client.get(`/accounts/callback/gmail?state=${'x'.repeat(state.length)}&code=abc`);
    assert.equal(forged.headers.get('location'), '/app.html?connect=invalid-state');
    const replayed = await client.get(`/accounts/callback/gmail?state=${state}&code=abc`);
    assert.equal(replayed.headers.get('location'), '/app.html?connect=invalid-state', 'a failed attempt spends the pending sign-in');
    assert.equal((await accountsOf(client)).accounts.length, 0);
});
test('a declined consent screen and an unconfigured provider end with a clear outcome', async () => {
    const { client } = await register(app, 'person@example.com');
    const state = new URL((await client.get('/accounts/connect/gmail')).headers.get('location')!).searchParams.get('state');
    assert.equal(
        (await client.get(`/accounts/callback/gmail?state=${state}&error=access_denied`)).headers.get('location'),
        '/app.html?connect=denied',
    );
    assert.equal((await client.get('/accounts/connect/outlook')).headers.get('location'), '/app.html?connect=unavailable');
    assert.equal((await client.get('/accounts/connect/yahoo')).headers.get('location'), '/app.html?connect=unavailable');
});
test('a completed Google sign-in stores the account with encrypted credentials', async () => {
    const { client } = await register(app, 'person@example.com');
    const state = new URL((await client.get('/accounts/connect/gmail')).headers.get('location')!).searchParams.get('state');
    app.setUpstream(url => {
        if (url.hostname === 'oauth2.googleapis.com')
            return json({
                access_token: 'access-secret',
                refresh_token: 'refresh-secret',
                expires_in: 3600,
                scope: 'openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/gmail.send',
            });
        if (url.hostname === 'openidconnect.googleapis.com') return json({ email: 'Real@Gmail.example', name: 'Real Person' });
        return undefined;
    });
    const done = await client.get(`/accounts/callback/gmail?state=${state}&code=auth-code`);
    assert.match(done.headers.get('location') ?? '', /^\/app\.html\?connect=ok&account=[0-9a-f-]{36}$/);

    const listed = await client.get('/accounts');
    const text = await listed.text();
    assert.ok(!/secret|credentials/.test(text), 'tokens never reach the browser');
    assert.equal((JSON.parse(text) as { accounts: Account[] }).accounts[0]!.email, 'real@gmail.example');
    const stored = await app.pool.query('SELECT credentials FROM mail_accounts');
    assert.ok(stored.rows[0].credentials && !/secret/.test(stored.rows[0].credentials), 'tokens are encrypted at rest');
});
test('consent without every mail permission is refused', async () => {
    const { client } = await register(app, 'person@example.com');
    const state = new URL((await client.get('/accounts/connect/gmail')).headers.get('location')!).searchParams.get('state');
    app.setUpstream(url =>
        url.hostname === 'oauth2.googleapis.com'
            ? json({
                  access_token: 'a',
                  refresh_token: 'r',
                  expires_in: 3600,
                  scope: 'openid email profile https://www.googleapis.com/auth/gmail.send',
              })
            : undefined,
    );
    const done = await client.get(`/accounts/callback/gmail?state=${state}&code=auth-code`);
    assert.equal(
        done.headers.get('location'),
        '/app.html?connect=failed',
        'the reason is not put in the address, where anyone could forge it',
    );
    const first = (await (await client.get('/accounts')).json()) as { accounts: Account[]; notice?: string };
    assert.match(first.notice ?? '', /^Allow every requested Gmail permission/);
    assert.equal(first.accounts.length, 0);
    assert.ok(!('notice' in (await accountsOf(client))), 'the reason is shown once');
});

test('syncing pulls the inbox, then applies later changes incrementally', async () => {
    const { client, user } = await register(app, 'person@example.com');
    const accountId = await connectGmail(user.userId);
    const seen: string[] = [];
    let inbox: Record<string, string[]> = { m1: ['INBOX', 'UNREAD'], m2: ['INBOX'] };
    app.setUpstream((url, init) => {
        if (url.hostname !== 'gmail.googleapis.com') return undefined;
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer access-secret');
        const path = url.pathname.replace('/gmail/v1/users/me/', '');
        seen.push(path);
        if (path === 'profile') return json({ historyId: '100' });
        if (path === 'messages') return json({ messages: Object.keys(inbox).map(id => ({ id })) });
        if (path === 'history')
            return json({
                historyId: '200',
                history: [
                    { messagesAdded: [{ message: { id: 'm3' } }] },
                    { labelsRemoved: [{ message: { id: 'm1' } }] },
                    { messagesDeleted: [{ message: { id: 'm2' } }] },
                ],
            });
        const id = path.replace('messages/', '');
        return inbox[id] ? json(gmailMessage(id, inbox[id])) : json({}, 404);
    });

    assert.deepEqual(await (await client.post(`/accounts/${accountId}/sync`)).json(), { processed: 2, removed: 0, hasMore: false });
    assert.deepEqual((await mailOf(client)).emails.map(item => [item.subject, item.isRead]).sort(), [
        ['Subject m1', false],
        ['Subject m2', true],
    ]);

    // m1 was archived, m2 deleted and m3 arrived.
    inbox = { m1: ['UNREAD'], m3: ['INBOX', 'UNREAD'] };
    seen.length = 0;
    assert.deepEqual(await (await client.post(`/accounts/${accountId}/sync`)).json(), { processed: 1, removed: 2, hasMore: false });
    assert.ok(seen[0] === 'history' && !seen.includes('messages'), 'later syncs use the history checkpoint');
    assert.deepEqual(
        (await mailOf(client)).emails.map(item => item.subject),
        ['Subject m3'],
    );
    const account = (await accountsOf(client)).accounts[0]!;
    assert.deepEqual([account.total, account.unread, account.lastError], [1, 1, null]);
});
test('a sign-in that Google rejects flags the account for reconnecting', async () => {
    const { client, user } = await register(app, 'person@example.com');
    const accountId = await connectGmail(user.userId);
    app.setUpstream(url => (url.hostname === 'gmail.googleapis.com' ? json({}, 401) : undefined));
    const response = await client.post(`/accounts/${accountId}/sync`);
    assert.equal(response.status, 502);
    assert.match(((await response.json()) as ApiError).error.message, /Reconnect/);
    const account = (await accountsOf(client)).accounts[0]!;
    assert.equal(account.needsReconnect, true);
    assert.match(account.lastError ?? '', /Reconnect/);
});
test('an unreachable provider is reported without leaking internals', async () => {
    const { client, user } = await register(app, 'person@example.com');
    const accountId = await connectGmail(user.userId);
    app.setUpstream(url => {
        if (url.hostname === 'gmail.googleapis.com') throw new Error('ECONNRESET at 10.0.0.7:443');
        return undefined;
    });
    const response = await client.post(`/accounts/${accountId}/sync`);
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), {
        error: { code: 'provider_error', message: 'The mail provider could not be reached. Try again shortly.' },
    });
    assert.equal((await accountsOf(client)).accounts[0]!.needsReconnect, false);
});

async function syncedMail(client: TestClient, userId: string) {
    const accountId = await connectGmail(userId);
    const sent: Array<{ raw: string; threadId?: string }> = [];
    const state = { sendStatus: 200 };
    app.setUpstream(async (url, init) => {
        if (url.hostname !== 'gmail.googleapis.com') return undefined;
        const path = url.pathname.replace('/gmail/v1/users/me/', '');
        if (path === 'profile') return json({ historyId: '100' });
        if (path === 'messages') return json({ messages: [{ id: 'm1' }] });
        if (path === 'messages/send') {
            if (state.sendStatus !== 200) return json({}, state.sendStatus);
            const body = JSON.parse(String(init.body)) as { raw: string; threadId?: string };
            sent.push({ ...body, raw: Buffer.from(body.raw, 'base64url').toString('utf8') });
            return json({ id: 'sent-1' });
        }
        if (path === 'messages/m1/modify') return json({ id: 'm1' });
        return json(gmailMessage('m1'));
    });
    await client.post(`/accounts/${accountId}/sync`);
    return { accountId, sent, state, email: (await mailOf(client)).emails[0]! };
}

test('a reply is threaded, recorded, and a repeated request is not sent twice', async () => {
    const { client, user } = await register(app, 'person@example.com');
    const { sent, email } = await syncedMail(client, user.userId);
    const request = { action: 'reply', requestId: randomUUID(), comment: 'Thanks, Ann.' };
    assert.equal((await client.post(`/emails/${email.id}/send`, request)).status, 202);
    assert.equal((await client.post(`/emails/${email.id}/send`, request)).status, 202);
    assert.equal(sent.length, 1, 'the retry was answered from the record, not sent again');
    assert.equal(sent[0]!.threadId, 't-m1');
    assert.match(sent[0]!.raw, /^To: ann@example\.com$/m);
    assert.match(sent[0]!.raw, /^Subject: Re: Subject m1$/m);
    assert.match(sent[0]!.raw, /^In-Reply-To: <m1@mail\.example>$/m);

    const reused = await client.post(`/emails/${email.id}/send`, { ...request, comment: 'Different text' });
    assert.equal(reused.status, 409, 'a request ID cannot be reused for another message');
    const detail = (await (await client.get(`/emails/${email.id}`)).json()) as {
        email: { conversation: Array<{ action: string; state: string }> };
    };
    assert.deepEqual(
        detail.email.conversation.map(item => [item.action, item.state]),
        [['reply', 'accepted']],
    );
});
test('when the provider fails mid-send the outcome is reported as uncertain and never retried blindly', async () => {
    const { client, user } = await register(app, 'person@example.com');
    const { accountId, sent, state } = await syncedMail(client, user.userId);
    const message = {
        accountId,
        requestId: randomUUID(),
        subject: 'Hello',
        body: 'Text',
        to: ['bob@example.com'],
        cc: ['carol@example.com'],
    };
    state.sendStatus = 503;
    const failed = await client.post('/emails/compose', message);
    assert.equal(failed.status, 502);
    assert.match(((await failed.json()) as ApiError).error.message, /uncertain/);
    state.sendStatus = 200;
    assert.equal((await client.post('/emails/compose', message)).status, 409);
    assert.equal(sent.length, 0);

    assert.equal((await client.post('/emails/compose', { ...message, requestId: randomUUID() })).status, 202);
    assert.match(sent[0]!.raw, /^Cc: carol@example\.com$/m);
    const states = await app.pool.query('SELECT state FROM outgoing_messages ORDER BY created_at');
    assert.deepEqual(
        states.rows.map(row => row.state),
        ['unknown', 'accepted'],
    );
});
test('marking a message read is written back to the provider', async () => {
    const { client, user } = await register(app, 'person@example.com');
    const { email } = await syncedMail(client, user.userId);
    const calls: unknown[] = [];
    app.setUpstream((url, init) => {
        if (!url.pathname.endsWith('/messages/m1/modify')) return undefined;
        calls.push(JSON.parse(String(init.body)));
        return json({ id: 'm1' });
    });
    assert.equal((await client.patch(`/emails/${email.id}/read`, { isRead: true })).status, 200);
    assert.equal((await client.patch(`/emails/${email.id}/read`, { isRead: true })).status, 200);
    assert.deepEqual(calls, [{ removeLabelIds: ['UNREAD'] }], 'an unchanged state is not sent again');
});
