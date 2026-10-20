import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { errorCodes } from '../../src/http/errors.js';
import { seedDemoData } from '../../src/scripts/demo-data.js';
import { createClient, register, startApp, type TestApp } from '../support/harness.js';

// Reads the operations from contracts/openapi.yaml without a YAML library: paths sit at two spaces, methods at four.
async function contractOperations() {
    const text = await readFile(new URL('../../contracts/openapi.yaml', import.meta.url), 'utf8');
    const paths = text.slice(text.indexOf('\npaths:\n'), text.indexOf('\ncomponents:\n'));
    const operations: Array<{ method: string; path: string; public: boolean }> = [];
    let current = '';
    for (const line of paths.split('\n')) {
        const path = /^ {2}(\/\S*):$/.exec(line)?.[1];
        if (path) current = path;
        const method = /^ {4}(get|post|put|patch|delete):$/.exec(line)?.[1];
        if (method) operations.push({ method: method.toUpperCase(), path: current, public: false });
        // `security: []` (public) or a list starting with `- {}` (session optional) at operation level.
        if (/^ {6}security: \[\]$/.test(line) || /^ {8}- \{\}$/.test(line)) operations.at(-1)!.public = true;
    }
    return { text, operations };
}

const sample: Record<string, string> = {
    provider: 'gmail',
    accountId: '00000000-0000-4000-8000-000000000001',
    emailId: '00000000-0000-4000-8000-000000000002',
    attachmentId: 'attachment-1',
};

let app: TestApp;
before(async () => {
    app = await startApp();
});
beforeEach(() => app.reset());
after(() => app.close());

test('every operation in the contract exists in the app', async () => {
    const { operations } = await contractOperations();
    assert.ok(operations.length >= 25, `found ${operations.length} operations`);
    const { client } = await register(app, 'contract@example.com');
    for (const { method, path } of operations) {
        if (path === '/auth/logout' || path === '/auth/password') continue; // Both end the session the loop needs.
        const url = path.replace(/\{(\w+)\}/g, (_match, name: string) => sample[name] ?? 'x');
        const response = await client.request(method, url, method === 'GET' ? undefined : {});
        const body = response.headers.get('content-type')?.includes('json') ? await response.json() : undefined;
        // The catch-all for unknown paths answers exactly this; a real route answers anything else.
        assert.notDeepEqual(body, { error: { code: 'not_found', message: 'Not found.' } }, `${method} ${path} is not implemented`);
    }
});

test('the contract lists exactly the error codes the server uses', async () => {
    const { text } = await contractOperations();
    const block = text.slice(text.indexOf('    ErrorCode:'), text.indexOf('\n    Uuid:'));
    const documented = [...block.matchAll(/^ {8}- (\w+)$/gm)].map(match => match[1]);
    assert.deepEqual(documented, [...errorCodes]);
});

const fill = (path: string, values: Record<string, string>) => path.replace(/\{(\w+)\}/g, (_match, name: string) => values[name] ?? 'x');

test('every operation that needs a session refuses a request without one', async () => {
    const { operations } = await contractOperations();
    const client = createClient(app.url);
    const guarded = operations.filter(operation => !operation.public);
    assert.ok(guarded.length >= 20);
    for (const { method, path } of guarded) {
        const response = await client.request(method, fill(path, sample), method === 'GET' ? undefined : {});
        // The two browser-navigation routes send people to the sign-in page instead of answering JSON.
        if (path.startsWith('/accounts/connect/') || path.startsWith('/accounts/callback/')) {
            assert.equal(response.status, 302, `${method} ${path}`);
            assert.equal(response.headers.get('location'), '/index.html');
            continue;
        }
        assert.equal(response.status, 401, `${method} ${path}`);
        assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'unauthenticated', `${method} ${path}`);
    }
});

test("every operation on an account or a message answers 404 for someone else's", async () => {
    await seedDemoData(app.pool);
    const { rows } = await app.pool.query<{ accountId: string; emailId: string }>(
        `SELECT a.account_id AS "accountId", e.email_id AS "emailId" FROM emails e JOIN mail_accounts a USING (account_id) LIMIT 1`,
    );
    const owned = { ...sample, accountId: rows[0]!.accountId, emailId: rows[0]!.emailId };
    const { client: intruder } = await register(app, 'intruder@example.com');
    const { operations } = await contractOperations();
    const scoped = operations.filter(operation => /\{(accountId|emailId)\}/.test(operation.path));
    assert.ok(scoped.length >= 9, `found ${scoped.length}`);
    // A body that is valid for each operation, so the answer is about ownership and not about input.
    const bodies: Record<string, unknown> = {
        'PATCH /emails/{emailId}/read': { isRead: true },
        'POST /emails/{emailId}/send': { action: 'reply', requestId: '00000000-0000-4000-8000-0000000000aa', comment: 'Hello' },
    };
    for (const { method, path } of scoped) {
        const response = await intruder.request(
            method,
            fill(path, owned),
            method === 'GET' ? undefined : (bodies[`${method} ${path}`] ?? {}),
        );
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'not_found', `${method} ${path}`);
    }
    // Nothing changed for the owner.
    const after = await app.pool.query('SELECT count(*)::int AS n FROM emails WHERE account_id = $1', [owned.accountId]);
    assert.ok(after.rows[0].n > 0);
});
