import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { errorCodes } from '../../src/http/errors.js';
import { register, startApp, type TestApp } from '../support/harness.js';

// Reads the operations from contracts/openapi.yaml without a YAML library: paths sit at two spaces, methods at four.
async function contractOperations() {
    const text = await readFile(new URL('../../contracts/openapi.yaml', import.meta.url), 'utf8');
    const paths = text.slice(text.indexOf('\npaths:\n'), text.indexOf('\ncomponents:\n'));
    const operations: Array<{ method: string; path: string }> = [];
    let current = '';
    for (const line of paths.split('\n')) {
        const path = /^ {2}(\/\S*):$/.exec(line)?.[1];
        if (path) current = path;
        const method = /^ {4}(get|post|put|patch|delete):$/.exec(line)?.[1];
        if (method) operations.push({ method: method.toUpperCase(), path: current });
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
