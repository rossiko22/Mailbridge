import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { createOAuthConnection } from '../src/integrations/outlook/oauth.js';
import { GraphError, type OAuthGraphConfig } from '../src/integrations/outlook/graph.js';
const config:OAuthGraphConfig={authMode:'oauth',tenantId:'consumers',clientId:'client',clientSecret:'secret',mailbox:'me@outlook.com',ownerEmail:'owner@example.com',redirectUri:'https://tickets.example.com/emails/connection/callback'};
function fixture(options:{wrongMailbox?:boolean; refreshFailure?:boolean}={}){
 let saved:any;let serialized='token-cache-including-refresh-secret';let authorization:any;let silent=0;
 const queries:string[]=[];
 const client={query:async(sql:string,values:any[])=>{queries.push(sql);if(sql.startsWith('INSERT'))saved={encrypted_cache:values[1],account_id:values[2],updated_at:'now'};return {rows:saved?[saved]:[]};},release(){}};
 const pool={connect:async()=>client,query:client.query} as unknown as Pool;
 const factory:any=()=>({
  getAuthCodeUrl:async(request:any)=>{authorization=request;return 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize';},
  getTokenCache:()=>({serialize:()=>serialized,deserialize:(value:string)=>{assert.equal(value,serialized);},getAccountByHomeId:async(id:string)=>({homeAccountId:id})}),
  acquireTokenByCode:async(request:any)=>{assert.ok(request.codeVerifier);return {accessToken:'token',account:{homeAccountId:'account'}};},
  acquireTokenSilent:async()=>{silent++;if(options.refreshFailure)throw new Error('private token secret');serialized='refreshed-token-cache';return {accessToken:'refreshed',account:{homeAccountId:'account'}};},
 });
 const makeGraph:any=(conf:any)=>({page:async()=>{if(options.wrongMailbox)throw new GraphError(502,'different mailbox');return {value:[],token:conf.accessToken};}});
 return {connection:createOAuthConnection(pool,config,'encryption-secret',factory,makeGraph),queries,saved:()=>saved,authorization:()=>authorization,silent:()=>silent};
}
test('OAuth authorization uses random state, S256 PKCE, fixed callback and offline consent',async()=>{
 const f=fixture();const first=await f.connection.beginOAuth();const second=await f.connection.beginOAuth();
 assert.notEqual(first.pending.state,second.pending.state);assert.ok(second.pending.expiresAt>Date.now());
 const request=f.authorization();assert.equal(request.codeChallenge,createHash('sha256').update(second.pending.verifier).digest('base64url'));
 assert.equal(request.codeChallengeMethod,'S256');assert.equal(request.redirectUri,config.redirectUri);assert.ok(request.scopes.includes('offline_access'));
});
test('OAuth persists encrypted cache only after mailbox verification and renews with MSAL',async()=>{
 const f=fixture();const {pending}=await f.connection.beginOAuth();await f.connection.completeOAuth('code',pending);
 assert.ok(f.saved());assert.equal(f.saved().encrypted_cache.includes('refresh-secret'),false);
 assert.equal((await f.connection.page() as any).token,'refreshed');assert.equal(f.silent(),1);
 assert.ok(f.queries.some(query=>query.includes('pg_advisory_xact_lock')));assert.equal(f.queries.at(-1),'COMMIT');
 assert.equal((await f.connection.status()).source,'microsoft');
});
test('OAuth wrong mailbox rolls back without saving credentials',async()=>{
 const f=fixture({wrongMailbox:true});const {pending}=await f.connection.beginOAuth();
 await assert.rejects(f.connection.completeOAuth('code',pending),/different mailbox/);
 assert.equal(f.saved(),undefined);assert.equal(f.queries.at(-1),'ROLLBACK');
});
test('OAuth refresh failures are sanitized and ask for reconnection',async()=>{
 const f=fixture({refreshFailure:true});const {pending}=await f.connection.beginOAuth();await f.connection.completeOAuth('code',pending);
 await assert.rejects(f.connection.page(),error=>error instanceof GraphError && /Reconnect/.test(error.message) && !error.message.includes('private token secret'));
});
test('OAuth missing connection gives setup instructions',async()=>{
 const f=fixture();await assert.rejects(f.connection.page(),/Connect Microsoft Outlook in Settings first/);
});
