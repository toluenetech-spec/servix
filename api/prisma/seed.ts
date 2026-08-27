/**
 * SERVIX seed — loads the frontend demo data into PostgreSQL.
 * Idempotent for catalogue/content tables. Never touches user accounts.
 */
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';

import { categories } from '../../src/data/categories.js';
import { professionals } from '../../src/data/professionals.js';
import { services } from '../../src/data/services.js';
import { reviews } from '../../src/data/reviews.js';
import { testimonials } from '../../src/data/testimonials.js';
import { pricingPlans } from '../../src/data/pricingPlans.js';
import { faqs } from '../../src/data/faqs.js';

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://servix:servix@127.0.0.1:5432/servix',
});
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log('Seeding Servix catalogue…');

  await prisma.review.deleteMany();
  await prisma.serviceFaq.deleteMany();
  await prisma.serviceMedia.deleteMany();
  await prisma.service.deleteMany();
  await prisma.portfolioItem.deleteMany();
  await prisma.professionalSkill.deleteMany();
  await prisma.professionalProfile.deleteMany();
  await prisma.category.deleteMany();
  await prisma.testimonial.deleteMany();
  await prisma.plan.deleteMany();
  await prisma.faq.deleteMany();

  const categoryIdBySlug = new Map<string, string>();
  for (const [i, c] of categories.entries()) {
    const row = await prisma.category.create({
      data: {
        slug: c.id,
        name: c.name,
        description: c.description,
        icon: c.icon,
        serviceCount: c.serviceCount,
        position: i,
      },
    });
    categoryIdBySlug.set(c.id, row.id);
  }
  console.log(`  categories: ${categories.length}`);

  const proIdBySlug = new Map<string, string>();
  for (const p of professionals) {
    const [city] = p.location.split(',').map((s: string) => s.trim());
    const row = await prisma.professionalProfile.create({
      data: {
        slug: p.id,
        name: p.name,
        title: p.title,
        about: p.about,
        locationCity: city,
        locationCountry: 'NG',
        categoryId: categoryIdBySlug.get(p.categoryId) ?? null,
        verification: p.verified ? 'verified' : 'unverified',
        availability: p.availability,
        responseTimeLabel: p.responseTime,
        memberSince: p.memberSince,
        imageUrl: p.image,
        ratingAvg: p.rating,
        reviewCount: p.reviewCount,
        completedProjects: p.completedProjects,
        startingPrice: BigInt(p.startingPrice),
        skills: { create: p.skills.map((skill: string, i: number) => ({ skill, position: i })) },
        portfolio: {
          create: p.portfolio.map((item: { title: string; category: string }, i: number) => ({
            title: item.title,
            category: item.category,
            position: i,
          })),
        },
      },
    });
    proIdBySlug.set(p.id, row.id);
  }
  console.log(`  professionals: ${professionals.length}`);

  const serviceIdBySlug = new Map<string, string>();
  for (const s of services) {
    const row = await prisma.service.create({
      data: {
        slug: s.id,
        title: s.title,
        professionalId: proIdBySlug.get(s.professionalId)!,
        categoryId: categoryIdBySlug.get(s.categoryId)!,
        shortDescription: s.shortDescription,
        description: s.description,
        price: BigInt(s.price),
        priceUnit: s.priceUnit,
        durationLabel: s.duration,
        locationLabel: s.location,
        isRemote: s.location.toLowerCase().includes('remote'),
        availability: s.availability,
        status: 'active',
        included: s.included,
        requirements: s.requirements,
        ratingAvg: s.rating,
        reviewCount: s.reviewCount,
        media: {
          create: s.gallery.map((url: string, i: number) => ({
            url,
            position: i,
            isCover: i === 0,
            altText: s.title,
          })),
        },
        faqs: {
          create: (s.faqs ?? []).map((f: { q: string; a: string }, i: number) => ({
            question: f.q,
            answer: f.a,
            position: i,
          })),
        },
      },
    });
    serviceIdBySlug.set(s.id, row.id);
  }
  console.log(`  services: ${services.length}`);

  for (const r of reviews) {
    await prisma.review.create({
      data: {
        serviceId: serviceIdBySlug.get(r.serviceId)!,
        professionalId: proIdBySlug.get(r.professionalId)!,
        author: r.author,
        rating: r.rating,
        text: r.text,
        reviewedAt: new Date(r.date),
      },
    });
  }
  console.log(`  reviews: ${reviews.length}`);

  for (const [i, t] of testimonials.entries()) {
    await prisma.testimonial.create({
      data: { quote: t.quote, author: t.author, role: t.role, isDemo: t.isDemo ?? true, position: i },
    });
  }
  for (const [i, p] of pricingPlans.entries()) {
    await prisma.plan.create({
      data: {
        slug: p.id,
        name: p.name,
        tagline: p.tagline,
        price: BigInt(p.price),
        period: p.period === 'forever' ? 'per month' : p.period,
        cta: p.cta,
        highlighted: p.highlighted,
        features: p.features,
        position: i,
      },
    });
  }
  for (const [context, list] of Object.entries(faqs)) {
    for (const [i, f] of (list as { q: string; a: string }[]).entries()) {
      await prisma.faq.create({ data: { context, question: f.q, answer: f.a, position: i } });
    }
  }
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
