import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loginThrottle } from '../src/middleware/security.middleware.js';
import { requireSameSiteJson } from '../src/middleware/json.middleware.js';
import { graphConfig } from '../src/config/graph.js';

test('login throttle persists counters across limiter instances and limits account guesses',async()=>{
 const values=new Map<string,number>();
 const pool:any={query:async(sql:string,params:string[])=>{if(sql.startsWith('DELETE'))return {rows:[]};const count=(values.get(params[0]!)||0)+1;values.set(params[0]!,count);return {rows:[{attempts:count}]};}};
 const first=loginThrottle(pool,'secret'),second=loginThrottle(pool,'secret');
 for(let attempt=1;attempt<=11;attempt++){
  let status=200,continued=false,retry='';
  const req:any={ip:'127.0.0.1',body:{email:'  User@example.com '}};
  const res:any={set(name:string,value:string){retry=value;return this;},status(value:number){status=value;return this;},json(){}};
  await (attempt%2?first:second)(req,res,()=>{continued=true;});
  assert.equal(status,attempt<=10?200:429);assert.equal(continued,attempt<=10);if(attempt===11)assert.equal(retry,'900');
 }
});
test('same-site JSON middleware rejects cross-site Origin and non-JSON writes',()=>{
 for(const [origin,json,expected] of [['https://evil.invalid',true,415],['https://tickets.example.com',false,415],['https://tickets.example.com',true,200]] as const){
  let status=200,continued=false;
  const req:any={method:'POST',protocol:'https',is:()=>json,get:(name:string)=>name==='host'?'tickets.example.com':name==='origin'?origin:undefined};
  const res:any={status(value:number){status=value;return this;},json(){}};
  requireSameSiteJson(req,res,()=>{continued=true;});assert.equal(status,expected);assert.equal(continued,expected===200);
 }
});
test('OAuth configuration requires an owner, secure callback and consistent production origin',()=>{
 const settings={GRAPH_AUTH_MODE:'oauth',GRAPH_TENANT_ID:'consumers',GRAPH_CLIENT_ID:'client',GRAPH_CLIENT_SECRET:'secret',GRAPH_MAILBOX:'ME@outlook.com',GRAPH_OWNER_EMAIL:'owner@example.com',GRAPH_REDIRECT_URI:'https://tickets.example.com/emails/connection/callback',NODE_ENV:'production',PUBLIC_ORIGIN:'https://tickets.example.com'};
 assert.equal(graphConfig(settings)?.authMode,'oauth');
 assert.throws(()=>graphConfig({...settings,GRAPH_OWNER_EMAIL:''}),/requires/);
 assert.throws(()=>graphConfig({...settings,GRAPH_REDIRECT_URI:'https://other.example.com/emails/connection/callback'}),/PUBLIC_ORIGIN/);
 assert.throws(()=>graphConfig({...settings,GRAPH_REDIRECT_URI:'http://tickets.example.com/emails/connection/callback'}),/HTTPS/);
 assert.equal(graphConfig({...settings,GRAPH_AUTH_MODE:'disabled'}),undefined);
});
