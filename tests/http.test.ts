import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request, Response } from 'express';
import { MailError } from '../src/integrations/mail/errors.js';
import { readDownload } from '../src/integrations/mail/http.js';
import { errorMiddleware } from '../src/middleware/error.middleware.js';
import { tokenVault } from '../src/security/token-vault.js';

const tooLarge = (error: unknown) => error instanceof MailError && error.status === 413;

test('downloads are read whole when they fit', async () => {
    assert.deepEqual(await readDownload(new Response('hello'), 10), Buffer.from('hello'));
    assert.deepEqual(await readDownload(new Response(null), 10), Buffer.alloc(0));
});
test('a download is refused when its declared size is over the limit', async () => {
    let cancelled = false;
    const body = new ReadableStream({
        cancel() {
            cancelled = true;
        },
    });
    await assert.rejects(readDownload(new Response(body, { headers: { 'Content-Length': '11' } }), 10), tooLarge);
    assert.equal(cancelled, true);
});
test('a download without a declared size is cut off once it passes the limit', async () => {
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
            sent++;
            controller.enqueue(new Uint8Array(4));
        },
    });
    await assert.rejects(readDownload(new Response(endless), 10), tooLarge);
    assert.ok(sent < 10, 'reading stopped soon after the limit');
});

function handle(error: unknown) {
    const result = { status: 0, body: undefined as unknown };
    const response = {
        headersSent: false,
        locals: {},
        status(code: number) {
            result.status = code;
            return response;
        },
        json(body: unknown) {
            result.body = body;
            return response;
        },
    };
    const logged: string[] = [];
    const original = console.error;
    console.error = (text: string) => {
        logged.push(text);
    };
    try {
        errorMiddleware(error, {} as Request, response as unknown as Response, () => {});
    } finally {
        console.error = original;
    }
    return { ...result, logged };
}
test('errors written for people pass through; everything else is hidden and logged without detail', () => {
    assert.deepEqual(handle(new MailError(404, 'Email not found.')), {
        status: 404,
        body: { error: { code: 'not_found', message: 'Email not found.' } },
        logged: [],
    });
    assert.deepEqual(handle(new MailError(502, 'Sign in again.', true)).body, {
        error: { code: 'reconnect_required', message: 'Sign in again.' },
    });
    assert.deepEqual(handle({ type: 'entity.too.large' }).body, {
        error: { code: 'body_too_large', message: 'Request body is too large.' },
    });
    assert.deepEqual(handle({ type: 'entity.parse.failed' }).body, { error: { code: 'invalid_json', message: 'Invalid JSON body.' } });
    const duplicate = handle(Object.assign(new Error('duplicate key'), { code: '23505', constraint: 'users_email_unique' }));
    assert.deepEqual([duplicate.status, (duplicate.body as { error: { code: string } }).error.code], [409, 'email_taken']);
    const hidden = handle(new Error('connect ECONNREFUSED 10.0.0.7:5432 password=hunter2'));
    assert.deepEqual(
        [hidden.status, hidden.body],
        [500, { error: { code: 'internal_error', message: 'An unexpected server error occurred.' } }],
    );
    assert.equal(hidden.logged.length, 1);
    assert.ok(!hidden.logged[0]!.includes('hunter2'), 'error messages are not written to the log');
});

test('stored credentials cannot be read with another key or after tampering', () => {
    const sealed = tokenVault('secret-one', 'account-1').encrypt('refresh-token');
    assert.notEqual(tokenVault('secret-one', 'account-1').encrypt('refresh-token'), sealed, 'each encryption uses a fresh nonce');
    assert.throws(() => tokenVault('secret-two', 'account-1').decrypt(sealed));
    const [iv, tag, data] = sealed.split('.') as [string, string, string];
    const flipped = Buffer.from(data, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    assert.throws(() => tokenVault('secret-one', 'account-1').decrypt([iv, tag, flipped.toString('base64')].join('.')));
    assert.throws(() => tokenVault('secret-one', 'account-1').decrypt('garbage'));
});
