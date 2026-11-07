import type { FastifyInstance } from 'fastify';
import { notify, notifyChatOnce } from '../lib/notifications.js';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAuth } from '../lib/authGuard.js';
import { ApiError, forbidden, notFound } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { audit } from '../lib/audit.js';
import { mediaUrl } from '../lib/storage.js';
import { MAX_STREAMS_PER_USER, deliveryMarks, isOnline, lastSeenAt, markDelivered, publish, publishMany, sseFrame, streamsFor, subscribe } from '../lib/chatEvents.js';
const pair = (a:string,b:string) => [a,b].sort().join(':');
const absent = () => notFound('NOT_FOUND','Conversation or connection not available.');
const member = (id:string) => ({OR:[{requesterId:id},{recipientId:id}]});
const participant = (id:string) => ({OR:[{participantAId:id},{participantBId:id}]});
const person = {id:true,fullName:true,professionalProfile:{select:{slug:true,title:true,imageUrl:true}}} as const;
type Person = {id:string;fullName:string;professionalProfile:{slug:string;title:string|null;imageUrl:string|null}|null};
/** Public shape of a participant: storage keys resolved to public URLs, nothing else added. */
const who = (p:Person) => ({id:p.id,fullName:p.fullName,professionalProfile:p.professionalProfile?{slug:p.professionalProfile.slug,title:p.professionalProfile.title,imageUrl:mediaUrl(p.professionalProfile.imageUrl)}:null});
export async function communityRoutes(app:FastifyInstance) {
  app.get('/community/config',async()=>({enabled:process.env.COMMUNITY_ENABLED==='true'}));
  await app.register(async scoped=>{
    scoped.addHook('preHandler',async(req,reply)=>{
      reply.header('Cache-Control','no-store');await requireAuth(req,reply);
      if(process.env.COMMUNITY_ENABLED!=='true') throw new ApiError(503,'COMMUNITY_DISABLED','Messaging and connections are not enabled yet. Existing bookings and support are still available.');
      const u=await prisma.user.findUnique({where:{id:req.auth!.sub}});
      if(!u||u.deletedAt||u.status!=='active'||!u.emailVerifiedAt) throw forbidden('An active verified account is required.');
    });
    scoped.get('/community/connections',async req=>{
      const id=req.auth!.sub;
      const records=await prisma.communityConnection.findMany({where:member(id),orderBy:{updatedAt:'desc'},take:100,include:{requester:{select:person},recipient:{select:person}}});
      return records.map(c=>({id:c.id,status:c.status,incoming:c.recipientId===id,blockedByMe:c.blockedById===id,person:who(c.requesterId===id?c.recipient:c.requester)}));
    });
    scoped.post('/community/connections',{config:{rateLimit:{max:10,timeWindow:'1 hour'}}},async req=>{
      const {profileSlug}=parseBody(z.object({profileSlug:z.string().min(1).max(160)}).strict(),req.body);const id=req.auth!.sub;
      const p=await prisma.professionalProfile.findUnique({where:{slug:profileSlug},include:{user:true}});const target=p?.user;
      if(!target||target.deletedAt||target.status!=='active'||target.role!=='professional') throw absent();
      if(target.id===id) throw new ApiError(400,'SELF_CONNECTION','You cannot connect with yourself.');
      const c=await prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
        const existing=await tx.communityConnection.findUnique({where:{pairKey:pair(id,target.id)}});if(existing)return existing;
        if(await tx.communityConnection.count({where:{requesterId:id,createdAt:{gte:new Date(Date.now()-3600000)}}})>=10)throw new ApiError(429,'CONNECTION_LIMIT','Please wait before sending more connection requests.');
        const created=await tx.communityConnection.upsert({where:{pairKey:pair(id,target.id)},create:{pairKey:pair(id,target.id),requesterId:id,recipientId:target.id},update:{}});
        const me=await tx.user.findUniqueOrThrow({where:{id},select:{fullName:true}});
        await notify(tx,{userId:target.id,type:'connection.request',title:'New connection request',body:`${me.fullName} would like to connect with you on Servix.`,link:'/dashboard/network'});
        return created;
      });
      publish(target.id,{type:'connection',connectionId:c.id,status:c.status});
      return {id:c.id,status:c.status};
    });
    scoped.post('/community/connections/:id/action',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async req=>{
      const {action}=parseBody(z.object({action:z.enum(['accept','decline','remove','block','unblock'])}).strict(),req.body);const cid=(req.params as {id:string}).id;const id=req.auth!.sub;
      return prisma.$transaction(async tx=>{
        const initial=await tx.communityConnection.findFirst({where:{id:cid,...member(id)}});if(!initial)throw absent();
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${initial.pairKey}, 0))::text`;
        await tx.$queryRaw`SELECT id FROM community_connections WHERE id = ${cid} FOR UPDATE`;
        const c=await tx.communityConnection.findFirst({where:{id:cid,...member(id)}});if(!c) throw absent();
        let status=c.status,blockedById=c.blockedById;
        if(action==='accept'||action==='decline'){if(c.recipientId!==id||c.status!=='pending') throw forbidden();status=action==='accept'?'accepted':'declined';}
        if(action==='remove'){if(c.status==='blocked') throw forbidden();status='removed';}
        if(action==='block'){if(c.status==='blocked'&&c.blockedById!==id) throw forbidden();status='blocked';blockedById=id;}
        if(action==='unblock'){if(c.status!=='blocked'||c.blockedById!==id) throw forbidden();status='removed';blockedById=null;}
        await tx.communityConnection.update({where:{id:cid},data:{status,blockedById}});
        if(action==='accept'){const me=await tx.user.findUniqueOrThrow({where:{id},select:{fullName:true}});await notify(tx,{userId:c.requesterId,type:'connection.accepted',title:'Connection accepted',body:`${me.fullName} accepted your connection request. You can now message each other.`,link:'/dashboard/network'});}
        await audit(tx,{actorId:id,entity:'connection',entityId:cid,action:`connection.${action}`});
        publishMany([c.requesterId,c.recipientId],{type:'connection',connectionId:cid,status});
        return {id:cid,status};
      });
    });
    scoped.get('/community/threads',async req=>{
      const id=req.auth!.sub;
      const records=await prisma.chatThread.findMany({where:participant(id),take:50,orderBy:{updatedAt:'desc'},include:{participantA:{select:person},participantB:{select:person},booking:{select:{reference:true,serviceTitle:true}},messages:{take:1,orderBy:[{createdAt:'desc'},{id:'desc'}]}}});
      const ids=records.map(t=>t.id);
      const [marks,counts]=await Promise.all([
        deliveryMarks(ids),
        ids.length?prisma.$queryRaw<Array<{thread_id:string;n:number}>>`SELECT m.thread_id, count(*)::int AS n FROM chat_messages m JOIN chat_threads t ON t.id = m.thread_id WHERE m.thread_id = ANY(${ids}::text[]) AND m.sender_id <> ${id} AND m.created_at > COALESCE(CASE WHEN t.participant_a_id = ${id} THEN t.read_at_a ELSE t.read_at_b END, 'epoch'::timestamp) GROUP BY m.thread_id`:Promise.resolve([] as Array<{thread_id:string;n:number}>),
      ]);
      const unreadBy=new Map(counts.map(c=>[c.thread_id,Number(c.n)]));
      return records.map(t=>{
        const last=t.messages[0],mine=t.participantAId===id,read=mine?t.readAtA:t.readAtB,otherId=mine?t.participantBId:t.participantAId,mark=marks.get(t.id);
        const unreadCount=unreadBy.get(t.id)??0;
        return {id:t.id,person:who(mine?t.participantB:t.participantA),booking:t.booking,bookingId:t.bookingId,connectionId:t.connectionId,
          lastMessage:last?.body??'',lastMessageAt:last?.createdAt??null,lastMessageSenderId:last?.senderId??null,lastMessageId:last?.id??null,
          unread:Boolean(last&&last.senderId!==id&&(!read||last.createdAt>read))||unreadCount>0,unreadCount,
          myReadAt:read,otherReadAt:mine?t.readAtB:t.readAtA,otherDeliveredAt:mark?(mine?mark.deliveredAtB:mark.deliveredAtA):null,
          online:isOnline(otherId),lastSeenAt:lastSeenAt(otherId),updatedAt:t.updatedAt};
      });
    });
    scoped.post('/community/threads',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async req=>{
      const body=parseBody(z.union([z.object({bookingId:z.string().uuid()}).strict(),z.object({connectionId:z.string().uuid()}).strict()]),req.body);const id=req.auth!.sub;
      if('connectionId' in body){const c=await prisma.communityConnection.findFirst({where:{id:body.connectionId,status:'accepted',...member(id)}});if(!c) throw absent();const t=await prisma.chatThread.upsert({where:{connectionId:c.id},create:{connectionId:c.id,participantAId:c.requesterId,participantBId:c.recipientId},update:{}});publishMany([c.requesterId,c.recipientId],{type:'thread',threadId:t.id});return {id:t.id};}
      const b=await prisma.booking.findUnique({where:{id:body.bookingId},include:{professional:{select:{userId:true}}}});
      if(!b?.professional.userId||![b.customerId,b.professional.userId].includes(id)) throw absent();
      if(b.customerId===b.professional.userId) throw new ApiError(400,'SELF_CHAT','You cannot message yourself.');
      const t=await prisma.chatThread.upsert({where:{bookingId:b.id},create:{bookingId:b.id,participantAId:b.customerId,participantBId:b.professional.userId},update:{}});publishMany([b.customerId,b.professional.userId],{type:'thread',threadId:t.id});return {id:t.id};
    });
    scoped.get('/community/threads/:id/messages',async req=>{
      const id=req.auth!.sub,threadId=(req.params as {id:string}).id;
      const t=await prisma.chatThread.findFirst({where:{id:threadId,...participant(id)}});if(!t) throw absent();
      const query=parseBody(z.object({before:z.string().uuid().optional()}),req.query);
      if(query.before&&!await prisma.chatMessage.findFirst({where:{id:query.before,threadId}})) throw absent();
      const messages=await prisma.chatMessage.findMany({where:{threadId},orderBy:[{createdAt:'desc'},{id:'desc'}],take:50,...(query.before?{cursor:{id:query.before},skip:1}:{})});
      const c=await prisma.communityConnection.findUnique({where:{pairKey:pair(t.participantAId,t.participantBId)}});
      const otherId=t.participantAId===id?t.participantBId:t.participantAId;
      const other=await prisma.user.findUnique({where:{id:otherId}});
      const mine=t.participantAId===id;const mark=(await deliveryMarks([t.id])).get(t.id);
      return {messages:messages.slice().reverse().map(m=>({id:m.id,body:m.body,senderId:m.senderId,createdAt:m.createdAt,clientId:m.clientId})),before:messages.length===50?messages[messages.length-1].id:null,canSend:Boolean(other&&!other.deletedAt&&other.status==='active'&&c?.status!=='blocked'&&(!t.connectionId||c?.status==='accepted')),
        myReadAt:mine?t.readAtA:t.readAtB,otherReadAt:mine?t.readAtB:t.readAtA,otherDeliveredAt:mark?(mine?mark.deliveredAtB:mark.deliveredAtA):null,online:isOnline(otherId),lastSeenAt:lastSeenAt(otherId),otherUserId:otherId};
    });
    scoped.post('/community/threads/:id/read',async req=>{
      const id=req.auth!.sub,tid=(req.params as {id:string}).id;const t=await prisma.chatThread.findFirst({where:{id:tid,...participant(id)}});if(!t) throw absent();
      if(t.participantAId===id)await prisma.$executeRaw`UPDATE chat_threads SET read_at_a = CURRENT_TIMESTAMP WHERE id = ${tid} AND participant_a_id = ${id}`;
      else await prisma.$executeRaw`UPDATE chat_threads SET read_at_b = CURRENT_TIMESTAMP WHERE id = ${tid} AND participant_b_id = ${id}`;
      publish(t.participantAId===id?t.participantBId:t.participantAId,{type:'read',threadId:tid,userId:id,at:new Date().toISOString()});
      return {ok:true};
    });
    scoped.post('/community/threads/:id/messages',{config:{rateLimit:{max:30,timeWindow:'1 minute'}}},async req=>{
      const {body,clientId}=parseBody(z.object({body:z.string().trim().min(1).max(4000),clientId:z.string().uuid()}).strict(),req.body);const id=req.auth!.sub,tid=(req.params as {id:string}).id;
      const sent=await prisma.$transaction(async tx=>{
        const t=await tx.chatThread.findFirst({where:{id:tid,...participant(id)}});if(!t) throw absent();
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR UPDATE`;
        const prior=await tx.chatMessage.findUnique({where:{senderId_clientId:{senderId:id,clientId}}});
        if(!prior&&await tx.chatMessage.count({where:{senderId:id,createdAt:{gte:new Date(Date.now()-60000)}}})>=30)throw new ApiError(429,'MESSAGE_LIMIT','Please wait before sending more messages.');
        const key=pair(t.participantAId,t.participantBId);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
        await tx.$queryRaw`SELECT id FROM community_connections WHERE pair_key = ${key} FOR UPDATE`;
        const c=await tx.communityConnection.findUnique({where:{pairKey:key}});
        const other=await tx.user.findUnique({where:{id:t.participantAId===id?t.participantBId:t.participantAId}});
        if(!other||other.deletedAt||other.status!=='active'||c?.status==='blocked'||(t.connectionId&&c?.status!=='accepted')) throw forbidden('Messaging is not available for this relationship.');
        const m=await tx.chatMessage.upsert({where:{senderId_clientId:{senderId:id,clientId}},create:{threadId:tid,senderId:id,body,clientId},update:{}});
        if(m.threadId!==tid) throw new ApiError(409,'MESSAGE_CONFLICT','Start a new message.');
        if(!prior){const me=await tx.user.findUniqueOrThrow({where:{id},select:{fullName:true}});await notifyChatOnce(tx,other.id,tid,me.fullName);}
        await tx.chatThread.update({where:{id:tid},data:{updatedAt:new Date()}});return {message:{id:m.id,body:m.body,senderId:m.senderId,createdAt:m.createdAt,clientId:m.clientId},participants:[t.participantAId,t.participantBId]};
      });
      publishMany(sent.participants,{type:'message',threadId:tid,message:sent.message});
      return {id:sent.message.id,body:sent.message.body,senderId:sent.message.senderId,createdAt:sent.message.createdAt,clientId:sent.message.clientId};
    });
    // Ephemeral typing signal, forwarded to the other participant's open streams only.
    scoped.post('/community/threads/:id/typing',{config:{rateLimit:{max:120,timeWindow:'1 minute'}}},async req=>{
      const {typing}=parseBody(z.object({typing:z.boolean()}).strict(),req.body);const id=req.auth!.sub,tid=(req.params as {id:string}).id;
      const t=await prisma.chatThread.findFirst({where:{id:tid,...participant(id)}});if(!t) throw absent();
      publish(t.participantAId===id?t.participantBId:t.participantAId,{type:'typing',threadId:tid,userId:id,typing});
      return {ok:true};
    });
    // "Delivered" watermark: the caller's client has received everything in the thread up to now.
    scoped.post('/community/threads/:id/delivered',{config:{rateLimit:{max:120,timeWindow:'1 minute'}}},async req=>{
      const id=req.auth!.sub,tid=(req.params as {id:string}).id;
      const t=await prisma.chatThread.findFirst({where:{id:tid,...participant(id)}});if(!t) throw absent();
      const at=await markDelivered(tid,id,t.participantAId===id?'a':'b');
      if(at) publish(t.participantAId===id?t.participantBId:t.participantAId,{type:'delivered',threadId:tid,userId:id,at:at.toISOString()});
      return {ok:true,at:at?at.toISOString():null,supported:Boolean(at)};
    });
    // Server-sent events: one stream per tab/app session. Events: hello, message, typing, read, delivered, presence, connection, thread.
    scoped.get('/community/events',async(req,reply)=>{
      const id=req.auth!.sub;
      if(streamsFor(id)>=MAX_STREAMS_PER_USER) throw new ApiError(429,'TOO_MANY_STREAMS','Too many open Messages sessions. Close another tab and try again.');
      // The socket can drop while we are still querying (e.g. a tab closes immediately); never register a stream for it.
      const socket=req.raw.socket;let closed=false;const earlyClose=()=>{closed=true;};socket.once('close',earlyClose);
      const threads=await prisma.chatThread.findMany({where:participant(id),select:{participantAId:true,participantBId:true}});
      socket.off('close',earlyClose);
      if(closed||socket.destroyed||req.raw.destroyed||reply.raw.destroyed){reply.hijack();if(!reply.raw.destroyed) reply.raw.end();return;}
      const partners=new Set(threads.map(t=>t.participantAId===id?t.participantBId:t.participantAId));
      const wasOnline=isOnline(id);
      reply.hijack();
      reply.raw.writeHead(200,{...(reply.getHeaders() as Record<string,string|number|string[]>),'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache, no-transform',connection:'keep-alive','x-accel-buffering':'no'});
      const write=(e:Parameters<typeof sseFrame>[0])=>{if(!reply.raw.destroyed) reply.raw.write(sseFrame(e));};
      const unsubscribe=subscribe(id,write);
      const lastSeen:Record<string,string>={};for(const p of partners){const at=lastSeenAt(p);if(at) lastSeen[p]=at.toISOString();}
      write({type:'hello',online:[...partners].filter(p=>isOnline(p)),lastSeen});
      if(!wasOnline) publishMany(partners,{type:'presence',userId:id,online:true,lastSeen:null});
      const heartbeat=setInterval(()=>{if(reply.raw.destroyed||socket.destroyed||!reply.raw.writable) close(); else reply.raw.write(': ping\n\n');},15_000);
      const close=()=>{if(closed)return;closed=true;clearInterval(heartbeat);unsubscribe();if(!isOnline(id)) publishMany(partners,{type:'presence',userId:id,online:false,lastSeen:new Date().toISOString()});if(!reply.raw.destroyed) reply.raw.end();};
      reply.raw.on('close',close);reply.raw.on('error',close);socket.on('close',close);socket.on('error',close);
      if(socket.destroyed) close();
    });

    // Booking participants may block even if they have never connected.
    scoped.post('/community/threads/:id/block',async req=>{
      const id=req.auth!.sub,tid=(req.params as {id:string}).id;const t=await prisma.chatThread.findFirst({where:{id:tid,...participant(id)}});if(!t) throw absent();
      const other=t.participantAId===id?t.participantBId:t.participantAId,key=pair(id,other);
      return prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
        const c=await tx.communityConnection.upsert({where:{pairKey:key},create:{pairKey:key,requesterId:id,recipientId:other,status:'blocked',blockedById:id},update:{}});
        await tx.communityConnection.updateMany({where:{id:c.id,OR:[{blockedById:null},{blockedById:id}]},data:{status:'blocked',blockedById:id}});
        await audit(tx,{actorId:id,entity:'connection',entityId:c.id,action:'connection.block'});return {ok:true};
      });
    });
  });
}
