import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGmailClient, createQuotaBudget, toSyncedMessage } from '../src/integrations/gmail/api.js';
import { MailError } from '../src/integrations/mail/errors.js';

const b64 = (text: string) => Buffer.from(text).toString('base64url');
const message = (id: string, labels = ['INBOX', 'UNREAD']) => ({
    id, labelIds: labels, snippet: 'Hello &amp; welcome', internalDate: '1790000000000',
    payload: { mimeType: 'multipart/mixed', headers: [{ name: 'Subject', value: 'Hi' }, { name: 'From', value: 'Ann <ann@example.com>' }], parts: [
        { mimeType: 'text/plain', body: { data: b64('Plain body') } },
        { mimeType: 'application/pdf', filename: 'a.pdf', body: { attachmentId: 'att1', size: 10 } },
    ] },
});
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

test('messages map to saved fields', () => {
    const synced = toSyncedMessage(message('m1'));
    assert.equal(synced.fields.subject, 'Hi');
    assert.deepEqual(synced.fields.sender, { name: 'Ann', address: 'ann@example.com' });
    assert.equal(synced.fields.isRead, false);
    assert.equal(synced.fields.hasAttachments, true);
    assert.equal(synced.fields.preview, 'Hello & welcome');
});
test('mail that left the inbox is reported as removed', () => {
    assert.equal(toSyncedMessage(message('m1', ['TRASH'])).removed, true);
});
test('first sync lists the inbox and then switches to history', async () => {
    const urls: string[] = [];
    const client = createGmailClient(async () => 'token', (async (input: RequestInfo | URL) => {
        const url = String(input); urls.push(url);
        if (url.includes('/profile')) return reply({ historyId: '100' });
        if (url.includes('/messages?')) return reply({ messages: [{ id: 'm1' }] });
        return reply(message('m1'));
    }) as typeof fetch);
    const page = await client.sync(null);
    assert.equal(page.messages.length, 1);
    assert.equal(page.hasMore, false);
    assert.deepEqual(JSON.parse(page.cursor), { mode: 'delta', historyId: '100' });
});
test('an expired history checkpoint is reported as 410 so the service can rebuild it', async () => {
    const client = createGmailClient(async () => 'token', (async () => reply({}, 404)) as typeof fetch);
    await assert.rejects(client.sync(JSON.stringify({ mode: 'delta', historyId: '1' })), (error: unknown) => error instanceof MailError && error.status === 410);
});
test('a rejected token asks for reconnect and never returns 401', async () => {
    const client = createGmailClient(async () => 'token', (async () => reply({}, 401)) as typeof fetch);
    await assert.rejects(client.sync(null), (error: unknown) => error instanceof MailError && error.status !== 401 && error.reconnect === true);
});
test('a rate-limited request is retried after a pause', async () => {
    const waits: number[] = [];
    let limited = 2;
    const client = createGmailClient(async () => 'token', (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/profile')) return reply({ historyId: '100' });
        if (url.includes('/messages?')) return reply({ messages: [{ id: 'm1' }] });
        if (limited-- > 0) return limited === 1 ? reply({}, 429) : reply({ error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, 403);
        return reply(message('m1'));
    }) as typeof fetch, async ms => { waits.push(ms); });
    const page = await client.sync(null);
    assert.equal(page.messages.length, 1);
    assert.equal(waits.length, 2);
});
test('rate limiting that does not clear is reported as 429 without asking for reconnect', async () => {
    let calls = 0;
    const client = createGmailClient(async () => 'token', (async () => { calls++; return reply({}, 429); }) as typeof fetch, async () => {});
    await assert.rejects(client.sync(null), (error: unknown) => error instanceof MailError && error.status === 429 && !error.reconnect);
    assert.equal(calls, 6);
});
test('a rate-limited send is not repeated', async () => {
    let calls = 0;
    const client = createGmailClient(async () => 'token', (async () => { calls++; return reply({}, 429); }) as typeof fetch, async () => {});
    await assert.rejects(client.compose({ to: ['a@example.com'], subject: 'Hi', body: 'Text' }), (error: unknown) => error instanceof MailError && error.status === 429);
    assert.equal(calls, 1);
});
test('requests beyond the per-minute quota wait for earlier ones to age out', async () => {
    let clock = 0;
    const waits: number[] = [];
    const budget = createQuotaBudget(100, async ms => { waits.push(ms); clock += ms; }, () => clock);
    for (let index = 0; index < 5; index++) { await budget.take(20); clock += 1_000; }
    assert.deepEqual(waits, []);
    await budget.take(20);
    assert.deepEqual(waits, [55_000]);
});
test('a sync page spends its quota from the shared mailbox budget', async () => {
    const taken: number[] = [];
    const client = createGmailClient(async () => 'token', (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/profile')) return reply({ historyId: '100' });
        if (url.includes('/messages?')) return reply({ messages: [{ id: 'm1' }, { id: 'm2' }] });
        return reply(message('m1'));
    }) as typeof fetch, async () => {}, { take: async units => { taken.push(units); } });
    await client.sync(null);
    assert.deepEqual(taken, [1, 5, 20, 20]);
});
