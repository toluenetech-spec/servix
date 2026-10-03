/**
 * Team / Enterprise workspaces (organisations).
 *
 *   POST   /team                      create (needs the team_workspace capability; one organisation per account)
 *   GET    /team                      my organisation: members, roles, limits, AI pool, my role
 *   PATCH  /team                      rename (owner/admin)
 *   POST   /team/invites              invite by email (owner/admin; counts against team_members)
 *   POST   /team/invites/accept       accept with the emailed token (signed-in user with the same email)
 *   DELETE /team/members/:id          remove a member or cancel an invitation (owner/admin; owner never removable)
 *   PATCH  /team/members/:id          change role (owner) / set a personal AI cap (owner/admin)
 *   POST   /team/leave                leave (non-owners)
 *   GET    /team/activity             recent member activity from the audit log (owner/admin)
 *   GET    /team/ai-usage             AI consumption by member and department this period (owner/admin)
 *   GET    /team/work                 shared read-only view of members' live proposals and open requests (owner/admin)
 *   GET    /team/audit                full organisation audit export (enterprise: org_audit_log)
 *
 * Members inherit the owner's plan through the entitlement engine; members never get administrative controls.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { prisma } from '../lib/db.js';
import { requireAuth } from '../lib/authGuard.js';
import { ApiError, notFound } from '../lib/errors.js';
import { parseBody } from '../lib/query.js';
import { audit } from '../lib/audit.js';
import { notify, notifySafely } from '../lib/notifications.js';
import { enqueueMail } from '../lib/jobs.js';
import { teamInviteMail } from '../lib/mailer.js';
import { newOpaqueToken, sha256 } from '../lib/tokens.js';
import { entitlementsFor, assertFeature, assertWithinLimit, canAccess, type Entitlements } from '../lib/entitlements/index.js';
import { aiMeters, periodStart, readMeter } from '../lib/entitlements/usage.js';

const guard = { preHandler: requireAuth };
const INVITE_DAYS = 7;
const TEAM_ACTIONS = ['proposal.', 'request.', 'booking.', 'service.', 'team.', 'plan.', 'portfolio.', 'availability.'];

function slugify(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'team';
  return `${base}-${randomUUID().slice(0, 6)}`;
}

type Membership = NonNullable<Awaited<ReturnType<typeof loadMembership>>>;
async function loadMembership(userId: string) {
  return prisma.organizationMember.findFirst({ where: { userId, status: 'active' }, include: { organization: true } });
}
async function requireMembership(req: FastifyRequest, roles?: Array<'owner' | 'admin' | 'member'>): Promise<{ ent: Entitlements; m: Membership }> {
  const ent = await entitlementsFor(req);
  const m = await loadMembership(req.auth!.sub);
  if (!m) throw notFound('TEAM_NOT_FOUND', 'You are not part of a team yet.');
  if (roles && !roles.includes(m.role)) throw new ApiError(403, 'TEAM_ROLE', 'Only team owners and admins can do that.');
  return { ent, m };
}

const serializeMember = (x: { id: string; role: string; status: string; invitedEmail: string | null; aiTokenCap: number | null; createdAt: Date; acceptedAt: Date | null; user: { id: string; fullName: string; email: string; role: string; professionalProfile: { slug: string; title: string; imageUrl: string | null } | null } | null }, viewerIsAdmin: boolean) => ({
  id: x.id, role: x.role, status: x.status, aiTokenCap: viewerIsAdmin ? x.aiTokenCap : undefined,
  email: viewerIsAdmin ? (x.user?.email ?? x.invitedEmail) : undefined,
  name: x.user?.fullName ?? (x.invitedEmail ? x.invitedEmail.split('@')[0] : 'Invited'),
  accountRole: x.user?.role ?? null, userId: x.user?.id ?? null,
  professional: x.user?.professionalProfile ? { slug: x.user.professionalProfile.slug, title: x.user.professionalProfile.title, image: x.user.professionalProfile.imageUrl } : null,
  invitedAt: x.createdAt.toISOString(), joinedAt: x.acceptedAt?.toISOString() ?? null,
});
const memberInclude = { user: { select: { id: true, fullName: true, email: true, role: true, professionalProfile: { select: { slug: true, title: true, imageUrl: true } } } } } as const;

export async function teamRoutes(app: FastifyInstance) {
  app.post('/team', { ...guard, config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags: ['team'], summary: 'Create a team workspace', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    const ent = await entitlementsFor(req);
    assertFeature(ent, 'team_workspace');
    if (ent.source !== 'account' && !ent.isAdmin) throw new ApiError(409, 'TEAM_EXISTS', 'You already belong to a team.');
    const { name } = parseBody(z.object({ name: z.string().trim().min(2).max(80) }).strict(), req.body);
    const existing = await prisma.organizationMember.findFirst({ where: { userId: ent.userId, status: 'active' } });
    if (existing) throw new ApiError(409, 'TEAM_EXISTS', 'You already belong to a team.');
    const org = await prisma.$transaction(async (tx) => {
      const o = await tx.organization.create({ data: { name, slug: slugify(name), ownerId: ent.userId } });
      await tx.organizationMember.create({ data: { organizationId: o.id, userId: ent.userId, role: 'owner', status: 'active', acceptedAt: new Date() } });
      await audit(tx, { actorId: ent.userId, action: 'team.created', entity: 'organization', entityId: o.id, data: { name } });
      return o;
    });
    req.entitlements = undefined;
    return reply.code(201).send({ id: org.id, name: org.name, slug: org.slug });
  });

  app.get('/team', { ...guard, schema: { tags: ['team'], summary: 'My team workspace', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const ent = await entitlementsFor(req);
    const m = await loadMembership(ent.userId);
    if (!m) return { team: null, canCreate: canAccess(ent, 'team_workspace'), plan: ent.plan };
    const isAdmin = m.role === 'owner' || m.role === 'admin';
    const [members, meters] = await Promise.all([
      prisma.organizationMember.findMany({ where: { organizationId: m.organizationId }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }], include: memberInclude }),
      aiMeters(ent),
    ]);
    return {
      team: { id: m.organization.id, name: m.organization.name, slug: m.organization.slug, createdAt: m.organization.createdAt.toISOString(), plan: ent.plan, planLabel: ent.planLabel, planSource: ent.source, active: ent.source !== 'account' },
      me: { role: m.role, isAdmin },
      members: members.map((x) => serializeMember(x, isAdmin)),
      limits: { members: ent.limits.team_members, aiTokens: ent.limits.monthly_ai_tokens },
      ai: isAdmin || !ent.organization ? meters.pool : { ...meters.pool, used: undefined, reserved: undefined },
      myAi: meters.member,
      capabilities: { analytics: canAccess(ent, 'team_analytics'), auditLog: canAccess(ent, 'org_audit_log'), customLimits: canAccess(ent, 'org_custom_limits') },
    };
  });

  app.patch('/team', { ...guard, schema: { tags: ['team'], summary: 'Rename the team', security: [{ bearerAuth: [] }] } }, async (req) => {
    const { m } = await requireMembership(req, ['owner', 'admin']);
    const { name } = parseBody(z.object({ name: z.string().trim().min(2).max(80) }).strict(), req.body);
    await prisma.$transaction(async (tx) => {
      await tx.organization.update({ where: { id: m.organizationId }, data: { name } });
      await audit(tx, { actorId: req.auth!.sub, action: 'team.renamed', entity: 'organization', entityId: m.organizationId, data: { name } });
    });
    return { ok: true, name };
  });

  app.post('/team/invites', { ...guard, config: { rateLimit: { max: 20, timeWindow: '1 minute' } }, schema: { tags: ['team'], summary: 'Invite someone by email', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    const { ent, m } = await requireMembership(req, ['owner', 'admin']);
    assertFeature(ent, 'team_workspace');
    if (ent.source === 'account') throw new ApiError(409, 'TEAM_PLAN_INACTIVE', 'Your team plan is not active. Renew it to invite members.');
    const { email, role } = parseBody(z.object({ email: z.string().trim().email().max(254), role: z.enum(['admin', 'member']).default('member') }).strict(), req.body);
    if (role === 'admin' && m.role !== 'owner') throw new ApiError(403, 'TEAM_ROLE', 'Only the owner can invite admins.');
    const lower = email.toLowerCase();
    const count = await prisma.organizationMember.count({ where: { organizationId: m.organizationId } });
    assertWithinLimit(ent, 'team_members', count, 1);
    const target = await prisma.user.findUnique({ where: { email: lower }, select: { id: true, fullName: true, email: true } });
    if (target) {
      const busy = await prisma.organizationMember.findFirst({ where: { userId: target.id, status: 'active' }, select: { organizationId: true } });
      if (busy?.organizationId === m.organizationId) throw new ApiError(409, 'ALREADY_MEMBER', 'That person is already in your team.');
      if (busy) throw new ApiError(409, 'MEMBER_ELSEWHERE', 'That person already belongs to another team.');
    }
    const dupe = await prisma.organizationMember.findFirst({ where: { organizationId: m.organizationId, status: 'invited', invitedEmail: lower } });
    const token = newOpaqueToken();
    const expires = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    const inviter = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub }, select: { fullName: true } });
    const row = await prisma.$transaction(async (tx) => {
      const r = dupe
        ? await tx.organizationMember.update({ where: { id: dupe.id }, data: { role, inviteTokenHash: token.hash, inviteExpiresAt: expires, invitedById: req.auth!.sub } })
        : await tx.organizationMember.create({ data: { organizationId: m.organizationId, role, status: 'invited', invitedEmail: lower, inviteTokenHash: token.hash, inviteExpiresAt: expires, invitedById: req.auth!.sub } });
      await audit(tx, { actorId: req.auth!.sub, action: 'team.invited', entity: 'organization', entityId: m.organizationId, data: { memberId: r.id, role } });
      if (target) await notify(tx, { userId: target.id, type: 'team.invite', title: `Invitation to join ${m.organization.name}`, body: `${inviter.fullName} invited you to their Servix team.`, link: `/join-team?token=${encodeURIComponent(token.raw)}` });
      return r;
    });
    await enqueueMail(teamInviteMail(lower, m.organization.name, inviter.fullName, token.raw), `team-invite-${row.id}-${sha256(token.raw).slice(0, 16)}`);
    const full = await prisma.organizationMember.findUniqueOrThrow({ where: { id: row.id }, include: memberInclude });
    return reply.code(201).send(serializeMember(full, true));
  });

  app.post('/team/invites/accept', { ...guard, config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['team'], summary: 'Accept a team invitation', security: [{ bearerAuth: [] }] } }, async (req) => {
    const { token } = parseBody(z.object({ token: z.string().min(16).max(200) }).strict(), req.body);
    const invite = await prisma.organizationMember.findUnique({ where: { inviteTokenHash: sha256(token) }, include: { organization: { select: { id: true, name: true, ownerId: true } } } });
    if (!invite || invite.status !== 'invited' || !invite.inviteExpiresAt || invite.inviteExpiresAt < new Date()) throw new ApiError(410, 'INVITE_INVALID', 'This invitation is no longer valid. Ask your team to send a new one.');
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.sub }, select: { id: true, email: true, fullName: true } });
    if (invite.invitedEmail && invite.invitedEmail !== user.email.toLowerCase()) throw new ApiError(403, 'INVITE_EMAIL_MISMATCH', 'This invitation was sent to a different email address.');
    const busy = await prisma.organizationMember.findFirst({ where: { userId: user.id, status: 'active' } });
    if (busy) throw new ApiError(409, 'MEMBER_ELSEWHERE', 'You already belong to a team. Leave it before joining another.');
    await prisma.$transaction(async (tx) => {
      await tx.organizationMember.update({ where: { id: invite.id }, data: { userId: user.id, status: 'active', acceptedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null } });
      await audit(tx, { actorId: user.id, action: 'team.joined', entity: 'organization', entityId: invite.organizationId, data: { memberId: invite.id, role: invite.role } });
      await notify(tx, { userId: invite.organization.ownerId, type: 'team.joined', title: `${user.fullName} joined ${invite.organization.name}`, body: 'Your team has a new member.', link: '/dashboard/team' });
    });
    req.entitlements = undefined;
    return { ok: true, team: { id: invite.organization.id, name: invite.organization.name } };
  });

  app.get('/team/invites/preview', { ...guard, schema: { tags: ['team'], summary: 'Peek at an invitation before accepting', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { token } = z.object({ token: z.string().min(16).max(200) }).parse(req.query ?? {});
    const invite = await prisma.organizationMember.findUnique({ where: { inviteTokenHash: sha256(token) }, include: { organization: { select: { name: true } }, invitedBy: { select: { fullName: true } } } });
    if (!invite || invite.status !== 'invited' || !invite.inviteExpiresAt || invite.inviteExpiresAt < new Date()) throw new ApiError(410, 'INVITE_INVALID', 'This invitation is no longer valid.');
    return { team: invite.organization.name, invitedBy: invite.invitedBy?.fullName ?? 'A team admin', role: invite.role, email: invite.invitedEmail, expiresAt: invite.inviteExpiresAt.toISOString() };
  });

  app.patch<{ Params: { id: string } }>('/team/members/:id', { ...guard, schema: { tags: ['team'], summary: 'Change a member’s role or personal AI cap', security: [{ bearerAuth: [] }] } }, async (req) => {
    const { ent, m } = await requireMembership(req, ['owner', 'admin']);
    const body = parseBody(z.object({ role: z.enum(['admin', 'member']).optional(), aiTokenCap: z.number().int().min(0).max(100_000_000).nullable().optional() }).strict(), req.body);
    const target = await prisma.organizationMember.findFirst({ where: { id: req.params.id, organizationId: m.organizationId } });
    if (!target) throw notFound('MEMBER_NOT_FOUND', 'Member not found');
    if (target.role === 'owner') throw new ApiError(409, 'TEAM_OWNER', 'The owner’s role cannot be changed here.');
    if (body.role !== undefined && m.role !== 'owner') throw new ApiError(403, 'TEAM_ROLE', 'Only the owner can change roles.');
    if (body.aiTokenCap !== undefined && body.aiTokenCap !== null && ent.limits.monthly_ai_tokens !== null && body.aiTokenCap > ent.limits.monthly_ai_tokens) throw new ApiError(422, 'VALIDATION_ERROR', 'A personal cap cannot exceed the team allowance.');
    const row = await prisma.$transaction(async (tx) => {
      const r = await tx.organizationMember.update({ where: { id: target.id }, data: { ...(body.role !== undefined ? { role: body.role } : {}), ...(body.aiTokenCap !== undefined ? { aiTokenCap: body.aiTokenCap } : {}) }, include: memberInclude });
      await audit(tx, { actorId: req.auth!.sub, action: 'team.member_updated', entity: 'organization', entityId: m.organizationId, data: { memberId: target.id, ...body } });
      return r;
    });
    return serializeMember(row, true);
  });

  app.delete<{ Params: { id: string } }>('/team/members/:id', { ...guard, schema: { tags: ['team'], summary: 'Remove a member or cancel an invitation', security: [{ bearerAuth: [] }] } }, async (req) => {
    const { m } = await requireMembership(req, ['owner', 'admin']);
    const target = await prisma.organizationMember.findFirst({ where: { id: req.params.id, organizationId: m.organizationId } });
    if (!target) throw notFound('MEMBER_NOT_FOUND', 'Member not found');
    if (target.role === 'owner') throw new ApiError(409, 'TEAM_OWNER', 'The owner cannot be removed.');
    if (target.role === 'admin' && m.role !== 'owner') throw new ApiError(403, 'TEAM_ROLE', 'Only the owner can remove admins.');
    await prisma.$transaction(async (tx) => {
      await tx.organizationMember.delete({ where: { id: target.id } });
      await audit(tx, { actorId: req.auth!.sub, action: 'team.member_removed', entity: 'organization', entityId: m.organizationId, data: { memberId: target.id, userId: target.userId, status: target.status } });
    });
    if (target.userId) await notifySafely({ userId: target.userId, type: 'team.removed', title: `You have left ${m.organization.name}`, body: 'Your account is back on its own plan. Nothing you created was removed.', link: '/dashboard/plan' });
    return { ok: true };
  });

  app.post('/team/leave', { ...guard, schema: { tags: ['team'], summary: 'Leave my team', security: [{ bearerAuth: [] }] } }, async (req) => {
    const { m } = await requireMembership(req);
    if (m.role === 'owner') throw new ApiError(409, 'TEAM_OWNER', 'Owners cannot leave their own team. Downgrade the plan instead.');
    await prisma.$transaction(async (tx) => {
      await tx.organizationMember.delete({ where: { id: m.id } });
      await audit(tx, { actorId: req.auth!.sub, action: 'team.left', entity: 'organization', entityId: m.organizationId, data: {} });
    });
    req.entitlements = undefined;
    return { ok: true };
  });

  /* ---------------- dashboards (owner / admin) ---------------- */

  app.get('/team/activity', { ...guard, schema: { tags: ['team'], summary: 'Recent team activity and member statistics', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { ent, m } = await requireMembership(req, ['owner', 'admin']);
    assertFeature(ent, 'team_analytics');
    const { days } = z.object({ days: z.coerce.number().int().min(7).max(90).default(30) }).parse(req.query ?? {});
    const since = new Date(Date.now() - days * 86_400_000);
    const members = await prisma.organizationMember.findMany({ where: { organizationId: m.organizationId, status: 'active', userId: { not: null } }, include: memberInclude });
    const userIds = members.map((x) => x.userId!).filter(Boolean);
    const proIds = await prisma.professionalProfile.findMany({ where: { userId: { in: userIds } }, select: { id: true, userId: true } });
    const proByUser = new Map(proIds.map((p) => [p.userId!, p.id]));
    const [proposals, requests, bookings, events] = await Promise.all([
      prisma.proposal.groupBy({ by: ['professionalId', 'status'], where: { professionalId: { in: proIds.map((p) => p.id) }, createdAt: { gte: since } }, _count: true }),
      prisma.serviceRequest.groupBy({ by: ['customerId', 'status'], where: { customerId: { in: userIds }, createdAt: { gte: since } }, _count: true }),
      prisma.booking.groupBy({ by: ['professionalId'], where: { professionalId: { in: proIds.map((p) => p.id) }, createdAt: { gte: since } }, _count: true, _sum: { amountKobo: true } }),
      prisma.auditLog.findMany({ where: { actorId: { in: userIds }, createdAt: { gte: since }, OR: TEAM_ACTIONS.map((prefix) => ({ action: { startsWith: prefix } })) }, orderBy: { createdAt: 'desc' }, take: 60, select: { id: true, actorId: true, action: true, entity: true, entityId: true, createdAt: true } }),
    ]);
    const nameOf = new Map(members.map((x) => [x.userId!, x.user?.fullName ?? 'Member']));
    const stats = members.map((x) => {
      const pid = proByUser.get(x.userId!);
      const sent = proposals.filter((p) => p.professionalId === pid).reduce((a, p) => a + p._count, 0);
      const accepted = proposals.filter((p) => p.professionalId === pid && p.status === 'accepted').reduce((a, p) => a + p._count, 0);
      const posted = requests.filter((r) => r.customerId === x.userId).reduce((a, r) => a + r._count, 0);
      const b = bookings.find((bk) => bk.professionalId === pid);
      return { memberId: x.id, userId: x.userId, name: nameOf.get(x.userId!), role: x.role, proposalsSent: sent, proposalsAccepted: accepted, requestsPosted: posted, bookings: b?._count ?? 0, bookingVolume: Number(b?._sum.amountKobo ?? 0n) / 100 };
    });
    return {
      days, since: since.toISOString(),
      totals: { members: members.length, proposalsSent: stats.reduce((a, s) => a + s.proposalsSent, 0), proposalsAccepted: stats.reduce((a, s) => a + s.proposalsAccepted, 0), requestsPosted: stats.reduce((a, s) => a + s.requestsPosted, 0), bookings: stats.reduce((a, s) => a + s.bookings, 0), bookingVolume: stats.reduce((a, s) => a + s.bookingVolume, 0) },
      members: stats,
      activity: events.map((e) => ({ id: e.id, actor: nameOf.get(e.actorId ?? '') ?? 'Member', action: e.action, entity: e.entity, entityId: e.entityId, at: e.createdAt.toISOString() })),
    };
  });

  app.get('/team/ai-usage', { ...guard, schema: { tags: ['team'], summary: 'Team AI usage by member and department (this period)', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { ent, m } = await requireMembership(req, ['owner', 'admin']);
    assertFeature(ent, 'team_analytics');
    const start = periodStart();
    const [members, byUser, byDepartment, daily, pool] = await Promise.all([
      prisma.organizationMember.findMany({ where: { organizationId: m.organizationId, status: 'active' }, include: memberInclude }),
      prisma.aiUsageEvent.groupBy({ by: ['userId'], where: { organizationId: m.organizationId, createdAt: { gte: start } }, _sum: { totalTokens: true }, _count: true }),
      prisma.aiUsageEvent.groupBy({ by: ['department'], where: { organizationId: m.organizationId, createdAt: { gte: start } }, _sum: { totalTokens: true }, _count: true }),
      prisma.$queryRaw<Array<{ day: Date; tokens: bigint; requests: bigint }>>`SELECT date_trunc('day', "created_at") AS day, COALESCE(SUM("total_tokens"), 0)::bigint AS tokens, COUNT(*)::bigint AS requests FROM "ai_usage_events" WHERE "organization_id" = ${m.organizationId} AND "created_at" >= ${start} GROUP BY 1 ORDER BY 1`,
      readMeter({ type: 'org', id: m.organizationId }, 'ai_tokens', ent.limits.monthly_ai_tokens),
    ]);
    const capMeters = await Promise.all(members.map(async (x) => x.aiTokenCap !== null && x.userId ? readMeter({ type: 'user', id: x.userId }, 'ai_tokens', x.aiTokenCap) : null));
    return {
      pool,
      members: members.map((x, i) => { const u = byUser.find((b) => b.userId === x.userId); return { memberId: x.id, userId: x.userId, name: x.user?.fullName ?? x.invitedEmail, role: x.role, tokens: u?._sum.totalTokens ?? 0, requests: u?._count ?? 0, cap: x.aiTokenCap, capMeter: capMeters[i] }; }).sort((a, b) => b.tokens - a.tokens),
      departments: byDepartment.map((d) => ({ department: d.department, tokens: d._sum.totalTokens ?? 0, requests: d._count })).sort((a, b) => b.tokens - a.tokens),
      daily: daily.map((d) => ({ date: d.day.toISOString().slice(0, 10), tokens: Number(d.tokens), requests: Number(d.requests) })),
    };
  });

  app.get('/team/work', { ...guard, schema: { tags: ['team'], summary: 'Shared view of members’ live proposals and open requests', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { ent, m } = await requireMembership(req, ['owner', 'admin']);
    assertFeature(ent, 'team_workspace');
    const members = await prisma.organizationMember.findMany({ where: { organizationId: m.organizationId, status: 'active', userId: { not: null } }, include: memberInclude });
    const userIds = members.map((x) => x.userId!);
    const nameOf = new Map(members.map((x) => [x.userId!, x.user?.fullName ?? 'Member']));
    const [proposals, requests] = await Promise.all([
      prisma.proposal.findMany({ where: { professional: { userId: { in: userIds } }, status: { in: ['submitted', 'accepted'] } }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, status: true, priceKobo: true, deliveryDays: true, createdAt: true, label: true, professional: { select: { userId: true, name: true } }, request: { select: { id: true, title: true, status: true } } } }),
      prisma.serviceRequest.findMany({ where: { customerId: { in: userIds }, status: { in: ['draft', 'open', 'paused', 'awarded'] } }, orderBy: { updatedAt: 'desc' }, take: 100, select: { id: true, title: true, status: true, proposalCount: true, customerId: true, deadlineAt: true, createdAt: true } }),
    ]);
    return {
      proposals: proposals.map((p) => ({ id: p.id, status: p.status, price: Number(p.priceKobo / 100n), deliveryDays: p.deliveryDays, label: p.label, createdAt: p.createdAt.toISOString(), member: nameOf.get(p.professional.userId ?? '') ?? p.professional.name, request: p.request })),
      requests: requests.map((r) => ({ id: r.id, title: r.title, status: r.status, proposalCount: r.proposalCount, deadlineAt: r.deadlineAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString(), member: nameOf.get(r.customerId) ?? 'Member' })),
    };
  });

  app.get('/team/audit', { ...guard, schema: { tags: ['team'], summary: 'Organisation audit log (Enterprise)', security: [{ bearerAuth: [] }] } }, async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const { ent, m } = await requireMembership(req, ['owner', 'admin']);
    assertFeature(ent, 'org_audit_log');
    const q = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50), format: z.enum(['json', 'csv']).default('json') }).parse(req.query ?? {});
    const members = await prisma.organizationMember.findMany({ where: { organizationId: m.organizationId, userId: { not: null } }, select: { userId: true, user: { select: { fullName: true, email: true } } } });
    const userIds = members.map((x) => x.userId!);
    const where = { OR: [{ actorId: { in: userIds } }, { entity: 'organization', entityId: m.organizationId }] };
    const [total, rows] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.format === 'csv' ? 0 : (q.page - 1) * q.pageSize, take: q.format === 'csv' ? 5000 : q.pageSize, select: { id: true, actorId: true, action: true, entity: true, entityId: true, createdAt: true } }),
    ]);
    const who = new Map(members.map((x) => [x.userId!, x.user?.fullName ?? 'Member']));
    const items = rows.map((r) => ({ id: r.id, actor: r.actorId ? who.get(r.actorId) ?? 'Servix' : 'Servix', action: r.action, entity: r.entity, entityId: r.entityId, at: r.createdAt.toISOString() }));
    if (q.format === 'csv') {
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="servix-team-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
      return `at,actor,action,entity,entityId\n${items.map((i) => [i.at, i.actor, i.action, i.entity, i.entityId].map(esc).join(',')).join('\n')}\n`;
    }
    return { total, page: q.page, pageSize: q.pageSize, items };
  });
}
