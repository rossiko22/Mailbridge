import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGmailClient, toSyncedMessage } from '../src/integrations/gmail/api.js';
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
