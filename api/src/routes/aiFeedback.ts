/**
 * Servix AI answer feedback — POST /api/v1/ai/feedback + GET /api/v1/admin/ai/feedback.
 *
 * Kept outside src/ai and routes/ai.ts on purpose: the AI layer itself never
 * writes to the database (enforced by api/tests/ai-router.test.ts). This file is
 * the one place where a user's thumbs-up/down on an answer is recorded.
 *
 * Privacy: the question and the answer are stored ONLY for a thumbs-down (the
 * chat tells the user so before they send it) so the Servix team can see what
 * went wrong. Thumbs-up stores just the rating, department and model alias.
 * Payments are never involved.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { requireAdmin, requireAuth } from '../lib/authGuard.js';
import { parseBody, parseQuery } from '../lib/query.js';

const RATE = { rateLimit: { max: 30, timeWindow: '1 minute' } };
const clean = (s: string | undefined, max: number) => {
  const t = (s ?? '').replace(/\u0000/g, '').trim();
  return t ? t.slice(0, max) : null;
};

const feedbackBody = z.object({
  rating: z.enum(['up', 'down']),
  department: z.string().min(1).max(60).regex(/^[a-z_]+$/).default('assistant'),
  comment: z.string().max(500).optional(),
  prompt: z.string().max(4000).optional(),
  answer: z.string().max(12000).optional(),
  modelAlias: z.string().max(40).regex(/^[a-z0-9_-]+$/).optional(),
});

const listQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).default(30),
  rating: z.enum(['up', 'down', 'all']).default('down'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

export async function aiFeedbackRoutes(app: FastifyInstance) {
  app.post('/ai/feedback', {
    preHandler: requireAuth,
    config: RATE,
    schema: {
      tags: ['ai'],
      summary: 'Rate a Servix AI answer (thumbs up/down). Question + answer are stored only for a thumbs-down.',
      body: {
        type: 'object',
        required: ['rating'],
        properties: {
          rating: { type: 'string', enum: ['up', 'down'] },
          department: { type: 'string' },
          comment: { type: 'string', maxLength: 500 },
          prompt: { type: 'string' },
          answer: { type: 'string' },
          modelAlias: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const body = parseBody(feedbackBody, req.body);
    const down = body.rating === 'down';
    const row = await prisma.aiFeedback.create({
      data: {
        userId: req.auth!.sub,
        department: body.department,
        rating: body.rating,
        comment: down ? clean(body.comment, 500) : null,
        prompt: down ? clean(body.prompt, 4000) : null,
        answer: down ? clean(body.answer, 12000) : null,
        modelAlias: clean(body.modelAlias, 40),
      },
      select: { id: true, rating: true, createdAt: true },
    });
    return reply.code(201).send({ ok: true, feedback: row });
  });

  /** Admin: satisfaction summary (daily up/down counts) + the list of ratings with prompt/answer for thumbs-down. */
  app.get('/admin/ai/feedback', {
    preHandler: requireAdmin,
    schema: { tags: ['admin'], summary: 'AI answer satisfaction: daily up/down counts and the unsatisfied answers (question + answer)' },
  }, async (req) => {
    const q = parseQuery(listQuery, req.query);
    const since = new Date(Date.now() - q.days * 86_400_000);
    since.setUTCHours(0, 0, 0, 0);
    const where = { createdAt: { gte: since }, ...(q.rating === 'all' ? {} : { rating: q.rating }) };

    const [all, total, items] = await Promise.all([
      prisma.aiFeedback.findMany({ where: { createdAt: { gte: since } }, select: { rating: true, createdAt: true, department: true } }),
      prisma.aiFeedback.count({ where }),
      prisma.aiFeedback.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { user: { select: { id: true, fullName: true, email: true, role: true } } },
      }),
    ]);

    // Daily series covering every day of the window (zeros included) so the chart has a stable x-axis.
    const byDay = new Map<string, { date: string; up: number; down: number }>();
    for (let i = 0; i <= q.days; i += 1) {
      const d = new Date(since.getTime() + i * 86_400_000);
      if (d.getTime() > Date.now()) break;
      const key = dayKey(d);
      byDay.set(key, { date: key, up: 0, down: 0 });
    }
    const byDepartment = new Map<string, { department: string; up: number; down: number }>();
    let up = 0; let down = 0;
    for (const r of all) {
      const key = dayKey(r.createdAt);
      const bucket = byDay.get(key) ?? { date: key, up: 0, down: 0 };
      byDay.set(key, bucket);
      const dept = byDepartment.get(r.department) ?? { department: r.department, up: 0, down: 0 };
      byDepartment.set(r.department, dept);
      if (r.rating === 'up') { bucket.up += 1; dept.up += 1; up += 1; } else { bucket.down += 1; dept.down += 1; down += 1; }
    }
    const rated = up + down;
    return {
      windowDays: q.days,
      since: since.toISOString(),
      totals: { up, down, rated, satisfaction: rated ? Math.round((up / rated) * 100) : null },
      daily: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
      byDepartment: Array.from(byDepartment.values()).sort((a, b) => (b.up + b.down) - (a.up + a.down)),
      items: items.map((f) => ({
        id: f.id,
        rating: f.rating,
        department: f.department,
        modelAlias: f.modelAlias,
        comment: f.comment,
        prompt: f.prompt,
        answer: f.answer,
        createdAt: f.createdAt,
        user: f.user ? { id: f.user.id, name: f.user.fullName, email: f.user.email, role: f.user.role } : null,
      })),
      page: q.page,
      pageSize: q.pageSize,
      total,
    };
  });
}
