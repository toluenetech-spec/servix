import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../lib/db.js';
import { parseBody, parseQuery } from '../lib/query.js';
import { serializeFaq, serializePlan, serializeTestimonial } from '../lib/serialize.js';

const faqQuerySchema = z.object({
  context: z.enum(['general', 'professionals', 'contact']).optional(),
});

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Please enter your name.').max(200),
  email: z.string().trim().email('Please enter a valid email address.').max(320),
  subject: z.string().trim().min(1, 'Please choose a subject.').max(200),
  message: z.string().trim().min(20, 'Please provide a little more detail.').max(5000),
  website: z.string().max(0).optional().or(z.literal('')),
});

export async function contentRoutes(app: FastifyInstance) {
  app.get(
    '/testimonials',
    { schema: { tags: ['content'], summary: 'List published testimonials' } },
    async () => {
      const rows = await prisma.testimonial.findMany({
        where: { isPublished: true },
        orderBy: { position: 'asc' },
      });
      return rows.map(serializeTestimonial);
    },
  );

  app.get('/plans', { schema: { tags: ['content'], summary: 'List active pricing plans' } }, async () => {
    const rows = await prisma.plan.findMany({ where: { isActive: true }, orderBy: { position: 'asc' } });
    return rows.map(serializePlan);
  });

  app.get(
    '/faqs',
    { schema: { tags: ['content'], summary: 'List FAQs, optionally filtered by context' } },
    async (req) => {
      const q = parseQuery(faqQuerySchema, req.query);
      const rows = await prisma.faq.findMany({
        where: { isPublished: true, ...(q.context ? { context: q.context } : {}) },
        orderBy: [{ context: 'asc' }, { position: 'asc' }],
      });
      if (q.context) return rows.map(serializeFaq);
      const grouped: Record<string, { q: string; a: string }[]> = {};
      for (const row of rows) (grouped[row.context] ??= []).push(serializeFaq(row));
      return grouped;
    },
  );

  app.post(
    '/contact',
    { schema: { tags: ['content'], summary: 'Submit a contact message' } },
    async (req, reply) => {
      const data = parseBody(contactSchema, req.body);
      if (data.website) return reply.code(201).send({ ok: true }); // honeypot
      await prisma.contactMessage.create({
        data: { name: data.name, email: data.email, subject: data.subject, message: data.message },
      });
      return reply.code(201).send({ ok: true });
    },
  );

  app.get('/stats', { schema: { tags: ['content'], summary: 'Public trust statistics' } }, async () => {
    const [pros, services, categories, ratingAgg] = await prisma.$transaction([
      prisma.professionalProfile.count({ where: { verification: 'verified' } }),
      prisma.service.count({ where: { status: 'active' } }),
      prisma.category.count({ where: { isActive: true } }),
      prisma.review.aggregate({ _avg: { rating: true }, where: { isPublished: true } }),
    ]);
    return {
      verifiedProfessionals: pros,
      activeServices: services,
      serviceCategories: categories,
      averageRating: ratingAgg._avg.rating ? Number(ratingAgg._avg.rating.toFixed(1)) : null,
    };
  });
}
