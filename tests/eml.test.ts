import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storedEml } from '../src/modules/emails/eml.js';
const email = { id:'ticket-1',subject:'Začetek čšž',senderName:'Ana\r\nBcc: attacker@example.com',senderAddress:'ana@example.com',receivedAt:'2026-10-01T12:00:00Z',body:'Pozdravljeni!\nDruga vrstica.' };
test('EML uses CRLF, encoded Unicode headers, base64 body and a snapshot marker',()=>{
 const output=storedEml(email,'support@example.com');
 assert.match(output,/Subject: =\?UTF-8\?B\?/);
 assert.equal(output.includes('\r\nBcc:'),false);
 assert.equal(output.replaceAll('\r\n','').includes('\n'),false);
 assert.equal(Buffer.from(output.split('\r\n\r\n')[1]!.replace(/\s/g,''),'base64').toString(),email.body.replaceAll('\n','\r\n'));
 assert.match(output,/X-Mail-Export: stored-text-snapshot/);
});
test('EML rejects header injection in addresses and folds long Unicode subjects',()=>{
 const output=storedEml({...email,senderAddress:'a@example.com\r\nBcc: evil@example.com',subject:'ž'.repeat(200)},'safe@example.com');
 assert.match(output,/<unknown@example.invalid>/);
 for(const line of output.split('\r\n')) assert.ok(line.length<=998);
 assert.equal(output.includes('\r\nBcc:'),false);
});
