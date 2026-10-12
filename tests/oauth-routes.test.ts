import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmailRouter } from '../src/modules/emails/emails.routes.js';
async function callback(query:Record<string,string>,pending:any){
 let location='',completed=false,saved=false;
 const connection:any={completeOAuth:async()=>{completed=true;}};
 const router=createEmailRouter({requireAuth:(_r:any,_s:any,next:any)=>next()} as any,{} as any,'owner@example.com',connection);
 const session:any={outlookOAuth:pending,save(next:any){saved=true;next();}};
 await new Promise<void>((resolve,reject)=>{
  router({method:'GET',url:'/connection/callback',query,session,currentUser:{userId:'id',email:'owner@example.com'}} as any,
   {set(){return this;},redirect(value:string){location=value;resolve();}} as any,reject);
 });
 return {location,completed,saved,session};
}
test('OAuth callback consumes session state before exchanging a valid code',async()=>{
 const result=await callback({code:'code',state:'expected'},{state:'expected',verifier:'verifier',expiresAt:Date.now()+60000});
 assert.equal(result.completed,true);assert.equal(result.saved,true);assert.equal(result.session.outlookOAuth,undefined);assert.equal(result.location,'/settings.html?outlook=connected');
});
for(const [label,pending] of [['missing',undefined],['expired',{state:'expected',expiresAt:Date.now()-1}],['mismatched',{state:'wrong',expiresAt:Date.now()+60000}]] as const){
 test(`OAuth callback rejects missing, expired or mismatched state: ${label}`,async()=>{
  const result=await callback({code:'code',state:'expected'},pending);assert.equal(result.completed,false);assert.match(result.location,/invalid-state/);
 });
}
test('OAuth denied consent returns a safe settings message',async()=>{
 const result=await callback({error:'access_denied',state:'expected'},{state:'expected',expiresAt:Date.now()+60000});
 assert.equal(result.completed,false);assert.match(result.location,/denied/);
});
