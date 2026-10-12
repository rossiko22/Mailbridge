// Creates and drops ONLY a uniquely named disposable database; requires CREATEDB.
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { Pool } from 'pg';
import { env } from '../src/config/env.ts';
const run=promisify(execFile);
const name=`ticket_mail_qa_${randomUUID().replaceAll('-','')}`;
const admin=new Pool({host:env.POSTGRES_HOST,port:env.POSTGRES_PORT,database:env.POSTGRES_DB,user:env.POSTGRES_USER,password:env.POSTGRES_PASSWORD});
let created=false;
try{
 await admin.query(`CREATE DATABASE "${name}"`);created=true;
 const childEnv={...process.env,POSTGRES_DB:name,NODE_ENV:'development',GRAPH_AUTH_MODE:'disabled',LOCAL_MAILBOX:'demo@example.test',LOCAL_OWNER_EMAIL:'manager@example.test',SESSION_SECRET:'isolated-clean-setup-test-secret',PUBLIC_ORIGIN:''};
 for(const script of ['src/scripts/migrate.ts','src/scripts/migrate.ts','src/scripts/seed-development.ts','src/scripts/seed-development.ts','tests/demo.database.ts']){
  const result=await run(process.execPath,['--import','tsx',script],{env:childEnv});process.stdout.write(result.stdout);
 }
}finally{if(created)await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);await admin.end();}
