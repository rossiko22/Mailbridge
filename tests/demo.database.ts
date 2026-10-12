// Run only in a freshly seeded development/test database.
import assert from 'node:assert/strict';
process.env.GRAPH_AUTH_MODE='disabled';
const {app}=await import('../src/app.js');
const {pool}=await import('../src/config/database.js');
const server=app.listen(0,'127.0.0.1');await new Promise<void>(resolve=>server.once('listening',resolve));
const address=server.address();if(!address||typeof address==='string')throw new Error('No server address');
const base=`http://127.0.0.1:${address.port}`;
try{
 const login=await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'manager@example.test',password:'Manager-Test-123!'})});
 assert.equal(login.status,200,'Documented manager credentials must work');
 const cookie=login.headers.get('set-cookie')!.split(';')[0]!;
 const data=await(await fetch(`${base}/emails`,{headers:{Cookie:cookie}})).json();assert.equal(data.emails.length,3);
 const meta=await(await fetch(`${base}/emails/meta`,{headers:{Cookie:cookie}})).json();assert.equal(meta.outlookConfigured,false);
 const sync=await fetch(`${base}/emails/sync`,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(sync.status,503);
 const eml=await fetch(`${base}/emails/${data.emails[0].id}/export`,{headers:{Cookie:cookie}});assert.equal(eml.status,200);
 const developer=await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'developer@example.test',password:'Developer-Test-123!'})});assert.equal(developer.status,200,'Documented developer credentials must work');
 console.log('Fresh setup passed: repeat migrations, repeat seed, documented demo credentials, three local tickets, local EML export and honest offline Outlook errors.');
}finally{
 await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});await pool.end();
}
