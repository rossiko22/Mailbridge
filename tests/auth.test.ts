import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { AppError } from '../src/http/errors.js';
import { parse } from '../src/http/validate.js';
import { createMailer } from '../src/integrations/mailer.js';
import { errorMiddleware } from '../src/middleware/error.middleware.js';
import { createAuthRouter } from '../src/modules/auth/auth.routes.js';
import { loginBody, registerBody } from '../src/modules/auth/auth.schemas.js';
import { createAuthService, RESET_MINUTES } from '../src/modules/auth/auth.service.js';
import type { UserRepository } from '../src/modules/users/users.repository.js';

const fails = (schema: Parameters<typeof parse>[0], input: unknown) =>
    assert.throws(
        () => parse(schema, input),
        (error: unknown) => error instanceof AppError && error.code === 'validation_failed',
    );

test('email and password rules', () => {
    const valid = { password: 'x'.repeat(12) };
    for (const email of ['a@b.co', ' padded@example.com ']) assert.equal(parse(registerBody, { ...valid, email }).email, email.trim());
    for (const email of ['', 'no-at-sign', 'a@b', 'two words@example.com', `${'x'.repeat(250)}@example.com`, 42, null])
        fails(registerBody, { ...valid, email });
    for (const password of ['x'.repeat(11), 'x'.repeat(1025), 123456789012]) fails(registerBody, { email: 'a@b.co', password });
    assert.equal(parse(registerBody, { email: 'a@b.co', ...valid }).displayName, '');
});
test('request bodies are strict: unknown fields are refused, so nothing extra can be smuggled in', () => {
    fails(loginBody, { email: 'a@b.co', password: 'x', isAdmin: true });
    fails(registerBody, { email: 'a@b.co', password: 'x'.repeat(12), userId: '00000000-0000-4000-8000-000000000000' });
});
test('a validation error names the failing fields but never echoes the submitted value', () => {
    try {
        parse(registerBody, { email: 'secret-value', password: 'short' });
        assert.fail('expected an error');
    } catch (error) {
        assert.ok(error instanceof AppError);
        assert.deepEqual(
            error.details?.map(detail => detail.path),
            ['email', 'password'],
        );
        assert.ok(!JSON.stringify(error.details).includes('secret-value'));
    }
});

test('registration can be switched off for the whole server', async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
        req.session = {} as typeof req.session;
        next();
    });
    app.use(
        '/auth',
        createAuthRouter({
            users: {} as never,
            auth: {} as never,
            requireAuth: async (_req, _res, next) => next(),
            allowRegistration: false,
        }),
    );
    app.use(errorMiddleware);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/auth`;
    try {
        const refused = await fetch(`${base}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'a@example.com', password: 'x'.repeat(12) }),
        });
        assert.equal(refused.status, 403);
        assert.equal(((await refused.json()) as { error: { code: string } }).error.code, 'registration_disabled');
        assert.deepEqual(await (await fetch(`${base}/config`)).json(), { registration: false });
    } finally {
        server.close();
    }
});

function resetSetup(user: { userId: string; email: string; isActive: boolean } | null) {
    const stored: Array<{ userId: string; hash: string; expiresAt: Date }> = [];
    const mailed: Array<{ to: string; link: string; minutes: number }> = [];
    const users = {
        findByEmail: async () => user,
        createResetToken: async (userId: string, hash: string, expiresAt: Date) => {
            stored.push({ userId, hash, expiresAt });
        },
    } as unknown as UserRepository;
    const service = createAuthService(
        users,
        {
            sendPasswordReset: async (to, link, minutes) => {
                mailed.push({ to, link, minutes });
            },
        },
        'https://mail.example',
        () => 1_000_000,
    );
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
    const log = {
        log: (text: string) => {
            lines.push(`log:${text}`);
        },
        warn: (text: string) => {
            lines.push(`warn:${text}`);
        },
    };
    await createMailer(undefined, 'development', log).sendPasswordReset('a@example.com', 'https://x.example/reset.html#token=abc', 30);
    await createMailer(undefined, 'production', log).sendPasswordReset('a@example.com', 'https://x.example/reset.html#token=SECRET', 30);
    assert.match(lines[0]!, /^log:.*#token=abc$/);
    assert.match(lines[1]!, /^warn:/);
    assert.ok(!lines[1]!.includes('SECRET'));
});
