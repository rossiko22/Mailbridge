import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalGraphPath, createGraphClient, toSyncedMessage } from '../src/integrations/outlook/graph.js';
import { MailError } from '../src/integrations/mail/errors.js';

const reply = (body: unknown, status = 200) => new Response(status === 202 ? null : JSON.stringify(body), { status });
const DELTA = "https://graph.microsoft.com/v1.0/me/mailFolders('inbox')/messages/delta?$deltatoken=abc";
const failsWith = (status: number, reconnect?: boolean) => (error: unknown) =>
    error instanceof MailError && error.status === status && (reconnect === undefined || error.reconnect === reconnect);

function recording(answer: (url: string, init: RequestInit) => Response) {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createGraphClient(
        async () => 'token',
        (async (input: RequestInfo | URL, init: RequestInit = {}) => {
            calls.push({ url: String(input), init });
            return answer(String(input), init);
        }) as typeof fetch,
        () => Date.UTC(2026, 9, 13),
    );
    return { client, calls };
}

test('partial updates keep only the fields Graph sent', () => {
    assert.deepEqual(toSyncedMessage({ id: 'a', isRead: true }), { id: 'a', fields: { isRead: true } });
    assert.deepEqual(toSyncedMessage({ id: 'a', '@removed': { reason: 'deleted' } }), { id: 'a', removed: true, fields: {} });
    const full = toSyncedMessage({
        id: 'a',
        subject: 'Hi',
        from: { emailAddress: { name: 'Ann', address: 'ann@example.com' } },
        hasAttachments: true,
    });
    assert.deepEqual(full.fields, { subject: 'Hi', sender: { name: 'Ann', address: 'ann@example.com' }, hasAttachments: true });
});
test('both continuation URL styles canonicalize to the same path', () => {
    const expected = '/v1.0/users/ann@example.com/mailFolders/inbox/messages/delta';
    assert.equal(canonicalGraphPath("/v1.0/users('ann%40example.com')/mailFolders('inbox')/messages/delta"), expected);
    assert.equal(canonicalGraphPath('/v1.0/users/ann@example.com/mailFolders/Inbox/messages/delta'), expected);
});
test('the first sync asks for the last 90 days and stores the continuation', async () => {
    const { client, calls } = recording(() => reply({ value: [{ id: 'm1', subject: 'Hi' }], '@odata.nextLink': DELTA }));
    const page = await client.sync(null);
    assert.match(calls[0]!.url, /receivedDateTime%20ge%202026-07-15T00:00:00Z/);
    assert.equal(new Headers(calls[0]!.init.headers).get('authorization'), 'Bearer token');
    assert.equal(calls[0]!.init.redirect, 'error');
    assert.deepEqual([page.messages.length, page.cursor, page.hasMore], [1, DELTA, true]);
});
test('a stored cursor is only followed when it points at the Graph inbox delta', async () => {
    const { client, calls } = recording(() => reply({ value: [], '@odata.deltaLink': DELTA }));
    for (const cursor of [
        'https://evil.example/v1.0/me/mailFolders/inbox/messages/delta',
        'https://graph.microsoft.com.evil.example/v1.0/me/mailFolders/inbox/messages/delta',
        'https://user:pass@graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta',
        'https://graph.microsoft.com/v1.0/me/messages',
        'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta/../../../../sendMail',
        'http://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta',
        'not a url',
    ])
        await assert.rejects(client.sync(cursor), failsWith(502), cursor);
    assert.equal(calls.length, 0, 'the bearer token was never sent anywhere');
    assert.equal((await client.sync(DELTA)).hasMore, false);
});
test('Graph failures become messages a person can act on', async () => {
    const status = (code: number) => recording(() => reply({}, code)).client;
    await assert.rejects(status(401).sync(null), failsWith(502, true));
    await assert.rejects(status(403).sync(null), failsWith(403, true));
    await assert.rejects(status(403).setRead('m1', true), failsWith(403, false));
    await assert.rejects(status(404).body('m1'), failsWith(404));
    await assert.rejects(status(410).sync(DELTA), failsWith(410));
    await assert.rejects(status(429).sync(null), failsWith(429, false));
    await assert.rejects(status(500).sync(null), failsWith(502));
    await assert.rejects(recording(() => reply({ value: 'nope' })).client.sync(null), failsWith(502));
});
test('a server error while sending is uncertain, not a clean failure', async () => {
    const { client } = recording(() => reply({}, 503));
    await assert.rejects(
        client.compose({ to: ['a@example.com'], cc: [], bcc: [], subject: 'Hi', body: 'Text' }),
        (error: unknown) => error instanceof Error && !(error instanceof MailError),
    );
});
test('compose and reply send the expected Graph requests', async () => {
    const { client, calls } = recording(() => reply(null, 202));
    await client.compose({ to: ['a@example.com'], cc: ['c@example.com'], bcc: [], subject: 'Hi', body: 'Text' });
    await client.send('id/with slash', 'forward', 'FYI', ['b@example.com']);
    assert.equal(calls[0]!.url, 'https://graph.microsoft.com/v1.0/me/sendMail');
    const composed = JSON.parse(String(calls[0]!.init.body));
    assert.deepEqual(composed.message.toRecipients, [{ emailAddress: { address: 'a@example.com' } }]);
    assert.equal(composed.message.body.contentType, 'Text');
    assert.equal(calls[1]!.url, 'https://graph.microsoft.com/v1.0/me/messages/id%2Fwith%20slash/forward');
    assert.deepEqual(JSON.parse(String(calls[1]!.init.body)).toRecipients, [{ emailAddress: { address: 'b@example.com' } }]);
});
test('cloud-link attachments are not downloaded and unknown ones are not found', async () => {
    const { client } = recording(url =>
        url.includes('$value')
            ? new Response('file-bytes')
            : reply({
                  value: [
                      { id: 'a1', name: 'report.pdf', size: 10, contentType: 'application/pdf' },
                      { id: 'a2', name: 'shared.docx', size: 0, contentType: 'x', '@odata.type': '#microsoft.graph.referenceAttachment' },
                  ],
              }),
    );
    assert.deepEqual(await client.attachment('m1', 'a1'), { name: 'report.pdf', data: Buffer.from('file-bytes') });
    await assert.rejects(client.attachment('m1', 'a2'), failsWith(400));
    await assert.rejects(client.attachment('m1', 'missing'), failsWith(404));
});
test('attachment paging never follows a link off Graph', async () => {
    const { client, calls } = recording(() =>
        reply({ value: [], '@odata.nextLink': 'https://evil.example/v1.0/me/messages/m1/attachments' }),
    );
    await assert.rejects(client.attachments('m1'), failsWith(502));
    assert.equal(calls.length, 1);
});
test('a message body must be HTML or text', async () => {
    assert.deepEqual(await recording(() => reply({ body: { contentType: 'HTML', content: '<p>Hi</p>' } })).client.body('m1'), {
        contentType: 'html',
        content: '<p>Hi</p>',
    });
    await assert.rejects(recording(() => reply({ body: { contentType: 'rtf', content: 'x' } })).client.body('m1'), failsWith(502));
    await assert.rejects(recording(() => new Response('not json')).client.body('m1'), failsWith(502));
});
