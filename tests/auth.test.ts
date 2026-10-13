import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import { createAuthController } from '../src/modules/auth/auth.controller.js';
import { createAuthService, RESET_MINUTES } from '../src/modules/auth/auth.service.js';
import { validEmail, validNewPassword } from '../src/modules/auth/auth.validation.js';
import { createMailer } from '../src/integrations/mailer.js';
import type * as repository from '../src/modules/users/users.repository.js';

test('email and password rules', () => {
    for (const value of ['a@b.co', ' padded@example.com ']) assert.equal(validEmail(value), true, value);
    for (const value of ['', 'no-at-sign', 'a@b', 'two words@example.com', `${'x'.repeat(250)}@example.com`, 42, null]) assert.equal(validEmail(value), false, String(value));
    assert.equal(validNewPassword('x'.repeat(11)), false);
    assert.equal(validNewPassword('x'.repeat(12)), true);
    assert.equal(validNewPassword('x'.repeat(1025)), false);
    assert.equal(validNewPassword(123456789012), false);
});

function fakeResponse() {
    const result = { status: 200, body: undefined as unknown };
    const response = { status(code: number) { result.status = code; return response; }, json(body: unknown) { result.body = body; return response; } };
    return { result, response: response as unknown as Response };
}
test('registration can be switched off for the whole server', async () => {
    const controller = createAuthController({} as never, {} as never, false);
    const { result, response } = fakeResponse();
    await controller.register({ body: { email: 'a@example.com', password: 'x'.repeat(12) } } as Request, response, () => assert.fail('no error expected'));
    assert.equal(result.status, 403);
    const config = fakeResponse();
    controller.config({} as Request, config.response);
    assert.deepEqual(config.result.body, { registration: false });
});

function resetSetup(user: { userId: string; email: string; isActive: boolean } | null) {
    const stored: Array<{ userId: string; hash: string; expiresAt: Date }> = [];
    const mailed: Array<{ to: string; link: string; minutes: number }> = [];
    const users = { findByEmail: async () => user, createResetToken: async (userId: string, hash: string, expiresAt: Date) => { stored.push({ userId, hash, expiresAt }); } } as unknown as typeof repository;
    const service = createAuthService(users, { sendPasswordReset: async (to, link, minutes) => { mailed.push({ to, link, minutes }); } }, 'https://mail.example', () => 1_000_000);
    return { service, stored, mailed };
}
test('a reset request stores only a hash and mails the token in the URL fragment', async () => {
    const { service, stored, mailed } = resetSetup({ userId: 'u1', email: 'person@example.com', isActive: true });
    await service.requestPasswordReset('person@example.com');
    const token = /^https:\/\/mail\.example\/reset\.html#token=([\w-]{43})$/.exec(mailed[0]!.link)?.[1];
    assert.ok(token, 'the token is in the fragment, which browsers do not send to servers');
    assert.equal(stored[0]!.hash, createHash('sha256').update(token).digest('hex'));
    assert.equal(stored[0]!.expiresAt.getTime(), 1_000_000 + RESET_MINUTES * 60_000);
    assert.deepEqual([mailed[0]!.to, mailed[0]!.minutes], ['person@example.com', 30]);
});
test('unknown and deactivated accounts get no reset token and no mail', async () => {
    for (const user of [null, { userId: 'u1', email: 'person@example.com', isActive: false }]) {
        const { service, stored, mailed } = resetSetup(user);
        await service.requestPasswordReset('person@example.com');
        assert.deepEqual([stored.length, mailed.length], [0, 0]);
    }
});
test('without SMTP the reset link is logged in development and never in production', async () => {
    const lines: string[] = [];
    const log = { log: (text: string) => { lines.push(`log:${text}`); }, warn: (text: string) => { lines.push(`warn:${text}`); } };
    await createMailer(undefined, 'development', log).sendPasswordReset('a@example.com', 'https://x.example/reset.html#token=abc', 30);
    await createMailer(undefined, 'production', log).sendPasswordReset('a@example.com', 'https://x.example/reset.html#token=SECRET', 30);
    assert.match(lines[0]!, /^log:.*#token=abc$/);
    assert.match(lines[1]!, /^warn:/);
    assert.ok(!lines[1]!.includes('SECRET'));
});
