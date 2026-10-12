// Smoke-test the production image with disposable Docker containers and synthetic credentials.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
const run=promisify(execFile);
const suffix=randomBytes(6).toString('hex'), network=`ticket-qa-${suffix}`, db=`ticket-qa-db-${suffix}`, app=`ticket-qa-app-${suffix}`;
const image=process.env.TEST_IMAGE||'ticket-mail:test';const password=randomBytes(24).toString('hex');
const docker=async(...args)=>(await run('docker',args,{maxBuffer:20*1024*1024})).stdout.trim();
const env={NODE_ENV:'production',POSTGRES_HOST:db,POSTGRES_PORT:'5432',POSTGRES_DB:'ticket_qa',POSTGRES_USER:'ticket_qa',POSTGRES_PASSWORD:password,
 SESSION_SECRET:randomBytes(32).toString('hex'),TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('hex'),PUBLIC_ORIGIN:'https://tickets.example.test',TRUST_PROXY:'1',
 GRAPH_AUTH_MODE:'application',GRAPH_TENANT_ID:'00000000-0000-0000-0000-000000000001',GRAPH_CLIENT_ID:'00000000-0000-0000-0000-000000000002',GRAPH_CLIENT_SECRET:'synthetic-no-external-requests',GRAPH_MAILBOX:'mailbox@example.invalid',GRAPH_OWNER_EMAIL:'manager@example.invalid'};
const envArgs=Object.entries(env).flatMap(([key,value])=>['-e',`${key}=${value}`]);
let networkCreated=false, dbCreated=false, appCreated=false;
try{
 await docker('network','create',network);networkCreated=true;
 await docker('run','-d','--name',db,'--network',network,'--tmpfs','/var/lib/postgresql','-e','POSTGRES_DB=ticket_qa','-e','POSTGRES_USER=ticket_qa','-e',`POSTGRES_PASSWORD=${password}`,'postgres:18-alpine');dbCreated=true;
 for(let i=0;i<60;i++){try{await docker('exec',db,'pg_isready','-U','ticket_qa','-d','ticket_qa');break;}catch{if(i===59)throw new Error('PostgreSQL startup timed out');await new Promise(r=>setTimeout(r,500));}}
 for(let i=0;i<2;i++)await docker('run','--rm','--network',network,...envArgs,image,'node','dist/scripts/migrate.js');
 await docker('run','--rm','--network',network,...envArgs,'-e','BOOTSTRAP_ADMIN_EMAIL=manager@example.invalid','-e',`BOOTSTRAP_ADMIN_PASSWORD=${password}`,image,'node','dist/scripts/bootstrap-admin.js');
 assert.equal(await docker('run','--rm',image,'id','-u'),'1000');
 await docker('run','--rm',image,'sh','-c','test ! -e /app/.env && test ! -e /app/.env.production && test ! -d /app/node_modules/tsx');
 await docker('run','-d','--name',app,'--network',network,'--read-only','--tmpfs','/tmp','-p','127.0.0.1::3000',...envArgs,image);appCreated=true;
 const mapping=await docker('port',app,'3000/tcp');const base=`http://${mapping}`;
 for(let i=0;i<40;i++){try{if((await fetch(`${base}/health`)).ok)break;}catch{}if(i===39)throw new Error('Application startup timed out');await new Promise(r=>setTimeout(r,500));}
 const login=await fetch(`${base}/auth/login`,{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-Proto':'https'},body:JSON.stringify({email:'manager@example.invalid',password})});
 assert.equal(login.status,200);const cookie=login.headers.get('set-cookie');assert.match(cookie,/Secure/);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Lax/);
 const me=await fetch(`${base}/auth/me`,{headers:{Cookie:cookie.split(';')[0],'X-Forwarded-Proto':'https'}});assert.equal(me.status,200);
 assert.match(me.headers.get('strict-transport-security'),/max-age/);assert.match(me.headers.get('content-security-policy'),/frame-ancestors/);
 const backup=(await run('docker',['exec',db,'pg_dump','-U','ticket_qa','-d','ticket_qa','-Fc'],{encoding:'buffer',maxBuffer:20*1024*1024})).stdout;
 await docker('exec',db,'createdb','-U','ticket_qa','ticket_qa_restore');
 await new Promise((resolve,reject)=>{const child=spawn('docker',['exec','-i',db,'pg_restore','-U','ticket_qa','-d','ticket_qa_restore','--exit-on-error'],{stdio:['pipe','ignore','pipe']});let error='';child.stderr.on('data',data=>{error+=data;});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error(error)));child.stdin.end(backup);});
 assert.equal(await docker('exec',db,'psql','-U','ticket_qa','-d','ticket_qa_restore','-Atc','SELECT count(*) FROM users'),'1');
 console.log('Production image passed: clean migrations, repeat migrations, administrator provisioning, non-root/read-only startup, health, HTTPS proxy cookies, authenticated API, secret exclusion, and pg_dump/pg_restore round trip. External Microsoft and public TLS were not exercised.');
}finally{
 if(appCreated)await docker('rm','-f',app);
 if(dbCreated)await docker('rm','-f',db);
 if(networkCreated)await docker('network','rm',network);
}
