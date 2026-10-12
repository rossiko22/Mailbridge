import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphClient, GraphError } from '../src/integrations/outlook/graph.js';
import type { AccessTokenGraphConfig } from '../src/integrations/outlook/graph.js';

const config = { tenantId: 'tenant', clientId: 'client', clientSecret: 'secret', mailbox: 'support@example.com' };
const cursor = 'https://graph.microsoft.com/v1.0/users/support%40example.com/mailFolders/inbox/messages/delta?$deltatoken=next';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });

test('uses server credentials, follows opaque cursors and caches tokens', async () => {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const request: typeof fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return String(url).includes('/token')
            ? json({ access_token: 'access', expires_in: 3600 })
            : json({ value: [{ id: 'message' }], '@odata.deltaLink': cursor });
    };
    const graph = createGraphClient(config, request);
    await graph.page();
    await graph.page(cursor);
    assert.equal(calls.length, 3);
    assert.equal(calls[0]!.init!.body instanceof URLSearchParams, true);
    assert.equal((calls[0]!.init!.body as URLSearchParams).get('grant_type'), 'client_credentials');
    assert.equal(calls[2]!.url, cursor);
    assert.match(new Headers(calls[1]!.init!.headers).get('Prefer')!, /ImmutableId/);
});

test('rejects foreign and other-mailbox cursors before any network request', async () => {
    const graph = createGraphClient(config, async () => { throw new Error('must not fetch'); });
    for (const url of ['https://evil.example/messages', cursor.replace('support%40example.com', 'other%40example.com')]) {
        await assert.rejects(graph.page(url), /Invalid Microsoft synchronization cursor/);
    }
});

test('refreshes a rejected token once', async () => {
    let tokens = 0;
    let requests = 0;
    const graph = createGraphClient(config, async url => {
        if (String(url).includes('/token')) return json({ access_token: `token${++tokens}`, expires_in: 3600 });
        return ++requests === 1 ? json({}, 401) : json({ value: [], '@odata.deltaLink': cursor });
    });
    await graph.page();
    assert.equal(tokens, 2);
    assert.equal(requests, 2);
});

for (const status of [410, 429, 403]) {
    test(`reports Microsoft ${status} without exposing response secrets`, async () => {
        const graph = createGraphClient(config, async url => String(url).includes('/token')
            ? json({ access_token: 'access', expires_in: 3600 }) : json({ secret: 'private-data' }, status));
        await assert.rejects(graph.page(), error => error instanceof GraphError &&
            error.status === (status === 403 ? 502 : status) && !error.message.includes('private-data'));
    });
}

const personal: AccessTokenGraphConfig = {
    authMode: 'access_token', accessToken: 'explorer-token', mailbox: 'personal@outlook.com', ownerEmail: 'owner@example.com',
};
const personalCursor = 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=next';
const profile = { id: 'account-id', mail: personal.mailbox, userPrincipalName: personal.mailbox };

test('personal mode uses the supplied token with /me and never requests client credentials', async () => {
    const calls: string[] = [];
    const graph = createGraphClient(personal, async (url, init) => {
        calls.push(String(url));
        assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer explorer-token');
        assert.equal(new URL(String(url)).origin, 'https://graph.microsoft.com');
        return String(url).includes('/me?') ? json(profile) : json({ value: [], '@odata.deltaLink': personalCursor });
    });
    await graph.page();
    await graph.page(personalCursor);
    assert.equal(calls.length, 3);
    assert.match(calls[1]!, /\/me\/mailFolders\/inbox\/messages\/delta/);
    assert.equal(calls[2], personalCursor);
});

test('personal mode rejects a token for a different account before importing messages', async () => {
    let calls = 0;
    const graph = createGraphClient(personal, async () => { calls++; return json({ ...profile, mail: 'other@outlook.com', userPrincipalName: 'other@outlook.com' }); });
    await assert.rejects(graph.page(), /different mailbox/);
    assert.equal(calls, 1);
});

test('personal mode reports expired tokens without retrying or returning application-login 401', async () => {
    let calls = 0;
    const graph = createGraphClient(personal, async url => {
        calls++;
        return String(url).includes('/me?') ? json(profile) : json({ error: 'sensitive upstream details' }, 401);
    });
    await assert.rejects(graph.page(), error => error instanceof GraphError && error.status === 502 &&
        error.message.includes('GRAPH_ACCESS_TOKEN') && !error.message.includes('sensitive upstream'));
    assert.equal(calls, 2);
});

test('expired personal token during account verification returns actionable error', async () => {
    const graph = createGraphClient(personal, async () => json({}, 401));
    await assert.rejects(graph.page(), /fresh Graph Explorer token in Settings/);
});

test('personal mode accepts an account-ID continuation only for the verified account', async () => {
    const graph = createGraphClient(personal, async url => String(url).includes('/me?') ? json(profile) : json({ value: [], '@odata.deltaLink': personalCursor }));
    await graph.page(personalCursor.replace('/me/', '/users/account-id/'));
    await assert.rejects(graph.page(personalCursor.replace('/me/', '/users/other-account/')), /Invalid Microsoft synchronization cursor/);
});

test('personal mode never sends a token to a foreign continuation host', async () => {
    const graph = createGraphClient(personal, async () => { throw new Error('must not fetch'); });
    await assert.rejects(graph.page('https://evil.example/v1.0/me/mailFolders/inbox/messages/delta'), /Invalid Microsoft synchronization cursor/);
});

test('reply and forward use Graph actions with immutable IDs and correct payloads', async () => {
    const sends: { url: string; body: unknown }[] = [];
    const graph = createGraphClient(personal, async (url, init) => {
        if (String(url).includes('/me?')) return json(profile);
        sends.push({ url: String(url), body: JSON.parse(String(init?.body)) });
        assert.equal(new Headers(init?.headers).get('Prefer'), 'IdType="ImmutableId"');
        return new Response(null, { status: 202 });
    });
    await graph.send('id/with+symbols', 'reply', 'Reply content', []);
    await graph.send('message', 'forward', 'Forward content', ['recipient@example.com']);
    assert.match(sends[0]!.url, /id%2Fwith%2Bsymbols\/reply$/);
    assert.deepEqual(sends[0]!.body, { comment: 'Reply content' });
    assert.deepEqual(sends[1]!.body, { comment: 'Forward content', toRecipients: [{ emailAddress: { address: 'recipient@example.com' } }] });
});
test('send permission failures explain Mail.Send and are never retried', async () => {
    let sends = 0;
    const graph = createGraphClient(personal, async url => {
        if (String(url).includes('/me?')) return json(profile);
        sends++; return json({},403);
    });
    await assert.rejects(graph.send('mail','reply','hello',[]), /Mail.Send/);
    assert.equal(sends,1);
});
test('uncertain send responses are not automatically retried', async () => {
    let sends = 0;
    const graph = createGraphClient(personal, async url => {
        if (String(url).includes('/me?')) return json(profile);
        sends++; return json({},503);
    });
    await assert.rejects(graph.send('mail','reply','hello',[]), /uncertain/);
    assert.equal(sends,1);
});

for (const account of ['me',"users('account-id')"]){
 test(`real Outlook OData continuation is accepted unchanged for verified account: ${account}`,async()=>{
  const actual=`https://graph.microsoft.com/v1.0/${account}/mailFolders('inbox')/messages/delta?$skiptoken=opaque%2Btoken%2Fvalue`;
  const urls:string[]=[];
  const graph=createGraphClient(personal,async url=>{urls.push(String(url));return String(url).includes('/me?')?json(profile):json({value:[],'@odata.deltaLink':actual});});
  await graph.page(actual);assert.equal(urls.at(-1),actual);
 });
}
test('application OData key-predicate continuation accepts only the configured mailbox',async()=>{
 const actual="https://graph.microsoft.com/v1.0/users('support%40example.com')/mailFolders('inbox')/messages/delta?$deltatoken=opaque";
 const graph=createGraphClient(config,async url=>String(url).includes('/token')?json({access_token:'token',expires_in:3600}):json({value:[],'@odata.deltaLink':actual}));
 await graph.page(actual);
 await assert.rejects(graph.page(actual.replace('support%40','other%40')),/Invalid Microsoft synchronization cursor/);
});
test('OData normalization does not permit other folders, accounts, hosts or malformed escapes',async()=>{
 const graph=createGraphClient(personal,async url=>{if(String(url).includes('/me?'))return json(profile);throw new Error('must not request an invalid cursor');});
 for(const value of [
  "https://graph.microsoft.com/v1.0/me/mailFolders('sentitems')/messages/delta?$skiptoken=x",
  "https://graph.microsoft.com/v1.0/users('other-account')/mailFolders('inbox')/messages/delta?$skiptoken=x",
  "https://attacker.invalid/v1.0/me/mailFolders('inbox')/messages/delta?$skiptoken=x",
  "https://graph.microsoft.com/v1.0/me/mailFolders('%zz')/messages/delta?$skiptoken=x",
  'not a URL',
 ])await assert.rejects(graph.page(value),/Invalid Microsoft synchronization cursor/);
});
