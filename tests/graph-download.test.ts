import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphClient, readDownload } from '../src/integrations/outlook/graph.js';
const config={tenantId:'tenant',clientId:'client',clientSecret:'secret',mailbox:'support@example.com'};
const json=(value:unknown)=>new Response(JSON.stringify(value));
test('compose sends text, To/Cc/Bcc and saves in Sent Items',async()=>{
 let payload:any;
 const graph=createGraphClient(config,async(url,init)=>String(url).includes('/token')?json({access_token:'token',expires_in:3600}):(payload=JSON.parse(String(init?.body)),new Response(null,{status:202})));
 await graph.compose({subject:'Hello',body:'<plain text>',to:['to@example.com'],cc:['cc@example.com'],bcc:['bcc@example.com']});
 assert.equal(payload.message.body.contentType,'Text');assert.equal(payload.message.bccRecipients[0].emailAddress.address,'bcc@example.com');assert.equal(payload.saveToSentItems,true);
});
test('attachment download verifies membership, encodes IDs and preserves bytes',async()=>{
 const urls:string[]=[];
 const graph=createGraphClient(config,async url=>{
  const value=String(url);urls.push(value);
  if(value.includes('/token'))return json({access_token:'token',expires_in:3600});
  if(value.endsWith('/$value'))return new Response(new Uint8Array([0,255,42]));
  return json({value:[{id:'file/1',name:'file.bin',size:3,contentType:'application/octet-stream','@odata.type':'#microsoft.graph.fileAttachment'}]});
 });
 assert.deepEqual((await graph.attachment('message/1','file/1')).data,Buffer.from([0,255,42]));
 assert.ok(urls.some(url=>url.endsWith('messages/message%2F1/attachments/file%2F1/$value')));
 await assert.rejects(graph.attachment('message/1','missing'),/not found/);
});
test('attachment pagination refuses external continuation before leaking bearer token',async()=>{
 const urls:string[]=[];
 const graph=createGraphClient(config,async url=>{
  urls.push(String(url));return String(url).includes('/token')?json({access_token:'token',expires_in:3600}):json({value:[],'@odata.nextLink':'https://attacker.invalid/steal'});
 });
 await assert.rejects(graph.attachments('message'),/Invalid attachment continuation/);
 assert.equal(urls.length,2);
});
test('cloud-link attachments return an actionable error',async()=>{
 const graph=createGraphClient(config,async url=>String(url).includes('/token')?json({access_token:'token',expires_in:3600}):json({value:[{id:'cloud',name:'link','@odata.type':'#microsoft.graph.referenceAttachment'}]}));
 await assert.rejects(graph.attachment('message','cloud'),/cloud-link/);
});
test('download size limits apply both with and without Content-Length',async()=>{
 await assert.rejects(readDownload(new Response('12345',{headers:{'Content-Length':'5'}}),4),/limit/);
 await assert.rejects(readDownload(new Response('12345'),4),/limit/);
 assert.equal((await readDownload(new Response('1234'),4)).toString(),'1234');
});
