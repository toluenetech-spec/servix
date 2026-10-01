/** Opt-in integration tests; creates its own loopback DB, never uses Neon. */
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

const origin = 'https://www.servix.name.ng';
describe.skipIf(process.env.RUN_LOCAL_COMMUNITY_TESTS !== '1')('community and workspace, isolated local PostgreSQL', () => {
  let cluster: EmbeddedPostgres; let directory: string; let app: FastifyInstance;
  let prisma: typeof import('../src/lib/db.js')['prisma'];
  let ip = 1;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'servix-security-test-'));
    const dbPassword = randomUUID();
    process.env.DATABASE_URL = `postgresql://postgres:${dbPassword}@127.0.0.1:55446/postgres`;
    process.env.AUTH_SECURITY_SECRET = randomUUID() + randomUUID();
    process.env.EMAIL_MODE = 'noop'; process.env.NODE_ENV = 'test'; process.env.AUTH_MFA_ENABLED = 'false'; process.env.COMMUNITY_ENABLED = 'true';
    process.env.CORS_ORIGINS = origin; process.env.AUTH_WEBAUTHN_ORIGINS = origin;
    process.env.AUTH_WEBAUTHN_RP_ID = 'servix.name.ng'; process.env.SCRYPT_LOG2_N = '10';
    cluster = new EmbeddedPostgres({ databaseDir: join(directory, 'db'), port: 55446, user: 'postgres', password: dbPassword,
      persistent: false, postgresFlags: ['-h', '127.0.0.1'], initdbFlags: ['--locale=C', '--lc-messages=C', '--encoding=UTF8'], onLog: () => {}, onError: console.error });
    await cluster.initialise(); await cluster.start();
    const client = cluster.getPgClient(); await client.connect();
    try {
      const root = join(import.meta.dirname, '../prisma/migrations');
      for (const name of (await readdir(root)).sort()) {
        if (name === 'migration_lock.toml') continue;
        await client.query(await readFile(join(root, name, 'migration.sql'), 'utf8'));
      }
    } finally { await client.end(); }
    prisma = (await import('../src/lib/db.js')).prisma;
    app = await (await import('../src/app.js')).buildApp(); await app.ready();
  });
  afterAll(async () => { await app?.close(); await prisma?.$disconnect(); if (cluster) await cluster.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });
  async function account(pro=false) {
    const user=await prisma.user.create({data:{email:`${randomUUID()}@example.test`,fullName:'Test Member',role:pro?'professional':'customer',status:'active',emailVerifiedAt:new Date(),passwordHash:'test-only'}});
    const slug=randomUUID();if(pro)await prisma.professionalProfile.create({data:{userId:user.id,name:'Test Professional',title:'Developer',slug}});
    const token=await(await import('../src/lib/tokens.js')).signAccessToken({sub:user.id,role:user.role,status:'active'});return {user,token,slug};
  }
  function call(token:string,path:string,body?:object,method?:'GET'|'POST'|'PATCH'){return app.inject({method:method??(body?'POST':'GET'),url:`/api/v1/${path}`,payload:body,headers:{authorization:`Bearer ${token}`},remoteAddress:`192.0.2.${ip++%240+1}`});}
  async function connected(){const a=await account(),b=await account(true);const c=(await call(a.token,'community/connections',{profileSlug:b.slug})).json();await call(b.token,`community/connections/${c.id}/action`,{action:'accept'});const t=(await call(a.token,'community/threads',{connectionId:c.id})).json();return {a,b,c,t};}
  it('requires authenticated verified accounts and respects the default-off switch',async()=>{
    expect((await call('','community/connections')).statusCode).toBe(401);const a=await account();process.env.COMMUNITY_ENABLED='false';expect((await call(a.token,'community/connections')).statusCode).toBe(503);process.env.COMMUNITY_ENABLED='true';await prisma.user.update({where:{id:a.user.id},data:{emailVerifiedAt:null}});expect((await call(a.token,'community/connections')).statusCode).toBe(403);
  });
  it('only the recipient can accept; outsiders cannot see or change the request',async()=>{
    const a=await account(),b=await account(true),c=await account();const request=(await call(a.token,'community/connections',{profileSlug:b.slug})).json();
    expect((await call(a.token,`community/connections/${request.id}/action`,{action:'accept'})).statusCode).toBe(403);
    expect((await call(c.token,`community/connections/${request.id}/action`,{action:'accept'})).statusCode).toBe(404);
    expect((await call(c.token,'community/connections')).json()).toEqual([]);
    expect((await call(a.token,'community/threads',{connectionId:request.id})).statusCode).toBe(404);
    expect((await call(b.token,`community/connections/${request.id}/action`,{action:'accept'})).json().status).toBe('accepted');
    const data=(await call(a.token,'community/connections')).json()[0];expect(data.person).not.toHaveProperty('email');
  });
  it('rejects self requests, unknown profiles and forged actor fields',async()=>{
    const a=await account(true);expect((await call(a.token,'community/connections',{profileSlug:a.slug})).statusCode).toBe(400);expect((await call(a.token,'community/connections',{profileSlug:'missing'})).statusCode).toBe(404);expect((await call(a.token,'community/connections',{profileSlug:a.slug,requesterId:randomUUID()})).statusCode).toBe(422);
  });
  it('text messaging is participant-only, bounded and retry-idempotent',async()=>{
    const {a,b,t}=await connected(),other=await account();const body={body:'Hello <script>alert(1)</script>',clientId:randomUUID()};const result=await call(a.token,`community/threads/${t.id}/messages`,body);expect(result.statusCode).toBe(200);expect((await call(a.token,`community/threads/${t.id}/messages`,body)).json().id).toBe(result.json().id);
    expect((await call(b.token,`community/threads/${t.id}/messages`)).json().messages).toHaveLength(1);
    expect((await call(other.token,`community/threads/${t.id}/messages`)).statusCode).toBe(404);expect((await call(other.token,`community/threads/${t.id}/messages`,{body:'intruder',clientId:randomUUID()})).statusCode).toBe(404);
    for(const text of ['  ','x'.repeat(4001)])expect((await call(a.token,`community/threads/${t.id}/messages`,{body:text,clientId:randomUUID()})).statusCode).toBe(422);
  });
  it('blocking stops sends in both directions while history remains available',async()=>{
    const {a,b,c,t}=await connected();await call(a.token,`community/threads/${t.id}/messages`,{body:'Earlier message',clientId:randomUUID()});await call(b.token,`community/connections/${c.id}/action`,{action:'block'});
    for(const u of [a,b])expect((await call(u.token,`community/threads/${t.id}/messages`,{body:'Blocked',clientId:randomUUID()})).statusCode).toBe(403);
    expect((await call(a.token,`community/threads/${t.id}/messages`)).json()).toMatchObject({canSend:false});expect((await call(a.token,`community/threads/${t.id}/messages`)).json().messages).toHaveLength(1);
    expect((await call(a.token,`community/connections/${c.id}/action`,{action:'unblock'})).statusCode).toBe(403);
  });
  it('connection removal stops new messages and mark-read clears unread without reordering',async()=>{
    const {a,b,c,t}=await connected();await call(a.token,`community/threads/${t.id}/messages`,{body:'Hello',clientId:randomUUID()});expect((await call(b.token,'community/threads')).json()[0].unread).toBe(true);const before=await prisma.chatThread.findUniqueOrThrow({where:{id:t.id}});await call(b.token,`community/threads/${t.id}/read`,{});expect((await call(b.token,'community/threads')).json()[0].unread).toBe(false);expect((await prisma.chatThread.findUniqueOrThrow({where:{id:t.id}})).updatedAt).toEqual(before.updatedAt);await call(a.token,`community/connections/${c.id}/action`,{action:'remove'});expect((await call(b.token,`community/threads/${t.id}/messages`,{body:'No',clientId:randomUUID()})).statusCode).toBe(403);
  });
  it('does not accept cross-thread cursors or reuse a client ID in a different thread',async()=>{
    const first=await connected(),other=await account(true);const c=(await call(first.a.token,'community/connections',{profileSlug:other.slug})).json();await call(other.token,`community/connections/${c.id}/action`,{action:'accept'});const t=(await call(first.a.token,'community/threads',{connectionId:c.id})).json();const body={body:'Only once',clientId:randomUUID()};const msg=(await call(first.a.token,`community/threads/${first.t.id}/messages`,body)).json();expect((await call(first.a.token,`community/threads/${t.id}/messages`,body)).statusCode).toBe(409);expect((await call(first.a.token,`community/threads/${t.id}/messages?before=${msg.id}`)).statusCode).toBe(404);
  });
  it('settings rejects role/email injection and security summary contains no secrets',async()=>{
    const a=await account();expect((await call(a.token,'account/profile',{fullName:'New Name'},'PATCH')).statusCode).toBe(200);expect((await prisma.user.findUniqueOrThrow({where:{id:a.user.id}})).fullName).toBe('New Name');expect((await call(a.token,'account/profile',{fullName:'Fake',role:'admin'},'PATCH')).statusCode).toBe(422);const s=(await call(a.token,'account/security-summary')).json();expect(Object.keys(s).sort()).toEqual(['method','passkeys','recoveryCodesRemaining']);expect((await call(a.token,'account/payments')).json()).toMatchObject({mode:'test',records:[]});
  });
});
