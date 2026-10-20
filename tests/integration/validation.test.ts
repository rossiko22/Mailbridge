import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, errorOf, PASSWORD, register, startApp, type TestApp, type TestClient } from '../support/harness.js';

let app: TestApp;
before(async () => {
    app = await startApp();
});
beforeEach(() => app.reset());
after(() => app.close());

async function expectInvalid(client: TestClient, method: string, path: string, body: unknown, fields: string[]) {
    const response = await client.request(method, path, body);
    const label = `${method} ${path} ${JSON.stringify(body)}`;
    assert.equal(response.status, 400, label);
    const error = await errorOf(response);
    assert.equal(error.code, 'validation_failed', label);
    assert.deepEqual(error.details?.map(detail => detail.path).sort(), fields.sort(), label);
}

test('signed-out auth endpoints reject invalid input with the failing fields', async () => {
    const client = createClient(app.url);
    await expectInvalid(client, 'POST', '/auth/register', { email: 'not-an-address', password: 'short' }, ['email', 'password']);
    await expectInvalid(client, 'POST', '/auth/register', { email: 'a@example.com', password: PASSWORD, displayName: 'x'.repeat(81) }, [
        'displayName',
    ]);
    await expectInvalid(client, 'POST', '/auth/register', { email: 'a@example.com', password: PASSWORD, role: 'admin' }, ['']);
    await expectInvalid(client, 'POST', '/auth/login', { email: 'a@example.com' }, ['password']);
    await expectInvalid(client, 'POST', '/auth/login', [], ['']);
    await expectInvalid(client, 'POST', '/auth/forgot', { email: 42 }, ['email']);
    await expectInvalid(client, 'POST', '/auth/reset', { token: 'short', password: PASSWORD }, ['token']);
    await expectInvalid(client, 'POST', '/auth/logout', { everywhere: true }, ['']);
});

test('signed-in auth and profile endpoints reject invalid input with the failing fields', async () => {
    const { client } = await register(app, 'person@example.com');
    await expectInvalid(client, 'POST', '/auth/password', { currentPassword: '', newPassword: 'short' }, [
        'currentPassword',
        'newPassword',
    ]);
    await expectInvalid(client, 'PATCH', '/users/me', { displayName: 'line\nbreak' }, ['displayName']);
    await expectInvalid(client, 'PATCH', '/users/me', {}, ['displayName']);
    await expectInvalid(client, 'PUT', '/users/me/avatar', { image: 7 }, ['image']);
    await expectInvalid(client, 'DELETE', '/users/me/avatar', { force: true }, ['']);
    const response = await client.get('/users/me/avatar?v=abc');
    assert.equal((await errorOf(response)).code, 'validation_failed');
    // Still signed in and unchanged after all of that.
    const me = (await (await client.get('/auth/me')).json()) as { user: { displayName: string } };
    assert.equal(me.user.displayName, 'Test Person');
});

test('a profile change succeeds and is trimmed', async () => {
    const { client } = await register(app, 'person@example.com');
    const response = await client.patch('/users/me', { displayName: '  New Name  ' });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as { user: { displayName: string } }).user.displayName, 'New Name');
});

test('mail and account endpoints reject invalid input with the failing fields', async () => {
    const { client } = await register(app, 'person@example.com');
    const id = '00000000-0000-4000-8000-000000000001';
    const message = { accountId: id, requestId: id, subject: 'Hi', body: 'Text', to: ['a@example.com'] };
    await expectInvalid(client, 'POST', '/emails/compose', { ...message, subject: 'Hi\r\nBcc: victim@example.com' }, ['subject']);
    await expectInvalid(client, 'POST', '/emails/compose', { ...message, to: ['a@example.com, b@example.com'] }, ['to.0']);
    await expectInvalid(client, 'POST', '/emails/compose', { ...message, to: [] }, ['to']);
    await expectInvalid(client, 'POST', '/emails/compose', { ...message, cc: Array(20).fill('c@example.com') }, ['to']);
    await expectInvalid(client, 'POST', '/emails/compose', { ...message, from: 'ceo@example.com' }, ['']);
    await expectInvalid(client, 'POST', '/emails/compose', { ...message, body: '   ' }, ['body']);
    await expectInvalid(
        client,
        'POST',
        `/emails/${id}/send`,
        { action: 'reply', requestId: id, comment: 'Hi', recipients: ['a@example.com'] },
        ['recipients'],
    );
    await expectInvalid(client, 'POST', `/emails/${id}/send`, { action: 'forward', requestId: id, comment: '', recipients: [] }, [
        'recipients',
    ]);
    await expectInvalid(client, 'POST', `/emails/${id}/send`, { action: 'delete', requestId: id }, ['action']);
    await expectInvalid(client, 'PATCH', `/emails/${id}/read`, { isRead: 'yes' }, ['isRead']);
    await expectInvalid(client, 'GET', `/emails/${id}/body?images=1`, undefined, ['images']);
    await expectInvalid(client, 'GET', `/emails/${id}/export?original=yes`, undefined, ['original']);
    await expectInvalid(client, 'GET', '/emails/not-a-uuid', undefined, ['id']);
    await expectInvalid(client, 'GET', `/emails?search=${'x'.repeat(201)}`, undefined, ['search']);
    await expectInvalid(client, 'GET', '/emails?unread=maybe', undefined, ['unread']);
    await expectInvalid(client, 'POST', `/accounts/${id}/sync`, { full: true }, ['']);
    await expectInvalid(client, 'DELETE', '/accounts/not-a-uuid', {}, ['id']);
});
