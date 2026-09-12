/**
 * Serializers: map Prisma rows to the exact JSON shapes the frontend
 * consumes. Slugs are exposed as `id`.
 */
import type {
  Category,
  ProfessionalProfile,
  ProfessionalSkill,
  PortfolioItem,
  Service,
  ServiceMedia,
  ServiceFaq,
  Review,
  Testimonial,
  Plan,
  Faq,
  User,
} from '../generated/prisma/client.js';

const num = (v: unknown): number => Number(v);

export function serializeCategory(c: Category) {
  return {
    id: c.slug,
    name: c.name,
    description: c.description ?? '',
    serviceCount: c.serviceCount,
    icon: c.icon ?? 'briefcase',
  };
}

type ServiceWithRels = Service & {
  media?: ServiceMedia[];
  faqs?: ServiceFaq[];
  category?: Category | null;
  professional?: ProfessionalProfile | null;
};

export function serializeServiceSummary(s: ServiceWithRels) {
  const cover = s.media?.find((m) => m.isCover) ?? s.media?.[0];
  return {
    id: s.slug,
    title: s.title,
    categoryId: s.category?.slug ?? s.categoryId,
    professionalId: s.professional?.slug ?? s.professionalId,
    rating: num(s.ratingAvg),
    reviewCount: s.reviewCount,
    price: num(s.price),
    priceUnit: s.priceUnit,
    duration: s.durationLabel ?? '',
    location: s.locationLabel ?? (s.isRemote ? 'Remote' : ''),
    availability: s.availability,
    image: cover?.url ?? null,
    shortDescription: s.shortDescription,
  };
}

export function serializeServiceDetail(s: ServiceWithRels) {
  return {
    ...serializeServiceSummary(s),
    gallery: (s.media ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((m) => m.url),
    description: s.description,
    included: s.included as string[],
    requirements: s.requirements as string[],
    faqs: (s.faqs ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((f) => ({ q: f.question, a: f.answer })),
  };
}

type ProWithRels = ProfessionalProfile & {
  skills?: ProfessionalSkill[];
  portfolio?: PortfolioItem[];
  category?: Category | null;
  services?: Service[];
};

export function serializeProfessionalSummary(p: ProWithRels) {
  return {
    id: p.slug,
    name: p.name,
    title: p.title,
    location: [p.locationCity, p.locationCountry === 'NG' ? 'Nigeria' : p.locationCountry]
      .filter(Boolean)
      .join(', '),
    categoryId: p.category?.slug ?? p.categoryId,
    rating: num(p.ratingAvg),
    reviewCount: p.reviewCount,
    startingPrice: p.startingPrice != null ? num(p.startingPrice) : null,
    verified: p.verification === 'verified',
    completedProjects: p.completedProjects,
    responseTime: p.responseTimeLabel ?? '',
    memberSince: p.memberSince ?? '',
    availability: p.availability,
    image: p.imageUrl ?? null,
  };
}

export function serializeProfessionalDetail(p: ProWithRels) {
  return {
    ...serializeProfessionalSummary(p),
    about: p.about ?? '',
    skills: (p.skills ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => s.skill),
    serviceIds: (p.services ?? []).map((s) => s.slug),
    portfolio: (p.portfolio ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((i) => ({ id: i.id, title: i.title, category: i.category ?? '' })),
  };
}

export function serializeReview(
  r: Review & { service?: Service | null; professional?: ProfessionalProfile | null },
) {
  return {
    id: r.id,
    serviceId: r.service?.slug ?? r.serviceId,
    professionalId: r.professional?.slug ?? r.professionalId,
    author: r.author,
    rating: r.rating,
    date: r.reviewedAt.toISOString().slice(0, 10),
    text: r.text ?? '',
  };
}

export function serializeTestimonial(t: Testimonial) {
  return { id: t.id, quote: t.quote, author: t.author, role: t.role ?? '', isDemo: t.isDemo };
}

export function serializePlan(p: Plan) {
  return {
    id: p.slug,
    name: p.name,
    tagline: p.tagline ?? '',
    price: num(p.price),
    period: num(p.price) === 0 ? 'forever' : p.period,
    cta: p.cta,
    highlighted: p.highlighted,
    features: p.features as string[],
  };
}

export function serializeFaq(f: Faq) {
  return { q: f.question, a: f.answer };
}

/** Phase B: the authenticated user shape returned by /auth endpoints and /me. */
export function serializeUser(u: User) {
  return {
    id: u.id,
    email: u.email,
    fullName: u.fullName,
    role: u.role,
    status: u.status,
    emailVerified: u.emailVerifiedAt != null,
    createdAt: u.createdAt.toISOString(),
  };
}
