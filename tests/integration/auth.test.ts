import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient, errorOf, PASSWORD, register, startApp, type TestApp } from '../support/harness.js';

let app: TestApp;
before(async () => {
    app = await startApp();
});
beforeEach(() => app.reset());
after(() => app.close());

const login = (email: string, password: string, client = createClient(app.url)) => client.post('/auth/login', { email, password });

test('registering signs the person in with a hardened cookie and never returns the password hash', async () => {
    const client = createClient(app.url);
    const response = await client.post('/auth/register', { email: 'new@example.com', password: PASSWORD, displayName: 'New Person' });
    assert.equal(response.status, 201);
    const cookie = response.headers.getSetCookie().find(line => line.startsWith('session=')) ?? '';
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    const body = await response.text();
    assert.ok(!/passwordHash|password_hash|argon2/.test(body));
    const me = (await (await client.get('/auth/me')).json()) as { user: Record<string, unknown> };
    assert.equal(me.user.email, 'new@example.com');
    assert.equal(me.user.displayName, 'New Person');
    assert.ok(!('passwordHash' in me.user));
    const stored = await app.pool.query('SELECT password_hash FROM users WHERE email = $1', ['new@example.com']);
    assert.match(stored.rows[0].password_hash, /^\$argon2id\$/);
});
test('registration rejects bad input and a second account for the same address', async () => {
    const client = createClient(app.url);
    assert.equal((await client.post('/auth/register', { email: 'not-an-email', password: PASSWORD })).status, 400);
    assert.equal((await client.post('/auth/register', { email: 'short@example.com', password: 'too-short' })).status, 400);
    assert.equal(
        (await client.post('/auth/register', { email: 'name@example.com', password: PASSWORD, displayName: 'x'.repeat(81) })).status,
        400,
    );
    await register(app, 'taken@example.com');
    const duplicate = await client.post('/auth/register', { email: 'TAKEN@example.com', password: PASSWORD });
    assert.equal(duplicate.status, 409);
    assert.equal((await app.pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n, 1);
});
test('sign-in gives the same answer for a wrong password and an unknown address', async () => {
    await register(app, 'person@example.com');
    const wrong = await login('person@example.com', 'wrong-password-123');
    const unknown = await login('nobody@example.com', 'wrong-password-123');
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    const [wrongError, unknownError] = [await errorOf(wrong), await errorOf(unknown)];
    assert.deepEqual(wrongError, unknownError);
    assert.equal(wrongError.code, 'invalid_credentials');
    assert.equal((await login('PERSON@example.com', PASSWORD)).status, 200);
    assert.equal((await login('person@example.com', '')).status, 400);
});
test('each sign-in gets a fresh session and signing out ends it on the server', async () => {
    await register(app, 'person@example.com');
    const first = createClient(app.url);
    const second = createClient(app.url);
    await login('person@example.com', PASSWORD, first);
    await login('person@example.com', PASSWORD, second);
    assert.notEqual(first.cookies.get('session'), second.cookies.get('session'));

    const stolen = first.cookies.get('session')!;
    assert.equal((await first.post('/auth/logout')).status, 200);
    assert.equal((await first.get('/auth/me')).status, 401);
    assert.equal((await createClient(app.url).get('/auth/me', { Cookie: `session=${stolen}` })).status, 401);
    assert.equal((await second.get('/auth/me')).status, 200);
});
test('a forged session cookie is ignored', async () => {
    const response = await createClient(app.url).get('/auth/me', { Cookie: 'session=s%3Aforged.signature' });
    assert.equal(response.status, 401);
});
test('changing the password needs the current one and signs out every session', async () => {
    const { client } = await register(app, 'person@example.com');
    const other = createClient(app.url);
    await login('person@example.com', PASSWORD, other);

    assert.equal(
        (await client.post('/auth/password', { currentPassword: 'not-the-password', newPassword: 'a-brand-new-password' })).status,
        400,
    );
    assert.equal((await client.post('/auth/password', { currentPassword: PASSWORD, newPassword: 'short' })).status, 400);
    assert.equal((await client.post('/auth/password', { currentPassword: PASSWORD, newPassword: 'a-brand-new-password' })).status, 200);

    assert.equal((await client.get('/auth/me')).status, 401);
    assert.equal((await other.get('/auth/me')).status, 401);
    assert.equal((await login('person@example.com', PASSWORD)).status, 401);
    assert.equal((await login('person@example.com', 'a-brand-new-password')).status, 200);
});
test('repeated failed sign-ins for one account are throttled without locking out others', async () => {
    await register(app, 'target@example.com');
    for (let attempt = 0; attempt < 10; attempt++) assert.equal((await login('target@example.com', 'wrong-password-123')).status, 401);
    const blocked = await login('target@example.com', PASSWORD);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('retry-after'), '900');
    assert.equal((await login('someone-else@example.com', 'wrong-password-123')).status, 401);
    const keys = await app.pool.query('SELECT key FROM login_attempts');
    assert.ok(
        keys.rows.every(row => /^[0-9a-f]{64}$/.test(row.key)),
        'throttle keys are hashed',
    );
});

// Without SMTP the reset link is written to the server log, which is where these tests read it.
async function requestReset(email: string) {
    const response = await createClient(app.url).post('/auth/forgot', { email });
    await delay(50);
    const line = app.logs.map(entry => String(entry.msg)).find(text => text.includes('Password reset link') && text.includes(email));
    return { response, token: line ? /#token=([\w-]+)/.exec(line)?.[1] : undefined };
}

test('asking for a reset reveals nothing about whether the address has an account', async () => {
    await register(app, 'person@example.com');
    const known = await requestReset('person@example.com');
    const unknown = await requestReset('nobody@example.com');
    assert.equal(known.response.status, 200);
    assert.equal(unknown.response.status, 200);
    assert.deepEqual(await known.response.json(), await unknown.response.json());
    assert.ok(known.token);
    assert.equal(unknown.token, undefined);
    const stored = await app.pool.query('SELECT token_hash FROM password_resets');
    assert.equal(stored.rowCount, 1);
    assert.notEqual(stored.rows[0].token_hash, known.token, 'only a hash of the token is stored');
});
test('a reset link works once, replaces the password and signs out existing sessions', async () => {
    const { client } = await register(app, 'person@example.com');
    const { token } = await requestReset('person@example.com');
    const visitor = createClient(app.url);
    assert.equal((await visitor.post('/auth/reset', { token, password: 'short' })).status, 400);
    assert.equal((await visitor.post('/auth/reset', { token: 'x'.repeat(43), password: 'a-brand-new-password' })).status, 400);
    assert.equal((await visitor.post('/auth/reset', { token, password: 'a-brand-new-password' })).status, 200);
    assert.equal((await visitor.post('/auth/reset', { token, password: 'another-new-password' })).status, 400);

    assert.equal((await client.get('/auth/me')).status, 401);
    assert.equal((await login('person@example.com', PASSWORD)).status, 401);
    assert.equal((await login('person@example.com', 'a-brand-new-password')).status, 200);
});
test('a deactivated account can neither sign in nor use a reset link issued before', async () => {
    const { user } = await register(app, 'person@example.com');
    const { token } = await requestReset('person@example.com');
    await app.pool.query('UPDATE users SET is_active = FALSE WHERE user_id = $1', [user.userId]);
    const signIn = await login('person@example.com', PASSWORD);
    assert.equal(signIn.status, 401);
    assert.equal((await errorOf(signIn)).code, 'invalid_credentials', 'the same answer as a wrong password');
    const reset = await createClient(app.url).post('/auth/reset', { token, password: 'a-brand-new-password' });
    assert.equal((await errorOf(reset)).code, 'invalid_reset_token');
    const unused = await app.pool.query('SELECT used_at FROM password_resets');
    assert.equal(unused.rows[0].used_at, null, 'nothing changed: the token is not even spent');
});
test('an expired reset link and a superseded one are both refused', async () => {
    await register(app, 'person@example.com');
    const first = await requestReset('person@example.com');
    const second = await requestReset('person@example.com');
    const visitor = createClient(app.url);
    assert.equal((await visitor.post('/auth/reset', { token: first.token, password: 'a-brand-new-password' })).status, 400);
    await app.pool.query("UPDATE password_resets SET expires_at = NOW() - INTERVAL '1 minute'");
    assert.equal((await visitor.post('/auth/reset', { token: second.token, password: 'a-brand-new-password' })).status, 400);
    assert.equal((await login('person@example.com', PASSWORD)).status, 200);
});
test('refusing an unknown address takes as long as refusing a wrong password', async () => {
    await register(app, 'person@example.com');
    const time = async (email: string) => {
        const started = performance.now();
        await login(email, 'wrong-password-123');
        return performance.now() - started;
    };
    await time('person@example.com');
    const known = Math.min(await time('person@example.com'), await time('person@example.com'));
    await time('nobody@example.com');
    const unknown = Math.min(await time('nobody@example.com'), await time('nobody-else@example.com'));
    assert.ok(unknown > known * 0.5, `unknown address answered in ${unknown.toFixed(0)}ms, known in ${known.toFixed(0)}ms`);
});
