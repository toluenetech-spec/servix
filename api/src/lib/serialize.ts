/**
 * Serializers: map Prisma rows to the exact JSON shapes the frontend
 * consumes. Slugs are exposed as `id`.
 */
import { effectivePlan } from './plans.js';
import { mediaUrl } from './storage.js';
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
  const images = (s.media ?? []).filter((m) => m.kind !== 'video' && m.kind !== 'document');
  const cover = images.find((m) => m.isCover) ?? images[0];
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
    image: mediaUrl(cover?.url),
    shortDescription: s.shortDescription,
  };
}

export interface ServiceRequirement { question: string; type: 'text' | 'choice' | 'file'; options: string[]; required: boolean }
export interface ServiceMediaItem { url: string; kind: 'image' | 'video' | 'document'; fileName: string }

/** Older services stored requirements as plain strings; expose one shape. */
export function normalizeRequirements(value: unknown): ServiceRequirement[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): ServiceRequirement | null => {
      if (typeof item === 'string') return item.trim() ? { question: item.trim(), type: 'text', options: [], required: false } : null;
      if (item && typeof item === 'object' && typeof (item as { question?: unknown }).question === 'string') {
        const r = item as Partial<ServiceRequirement>;
        return {
          question: r.question!,
          type: r.type === 'choice' || r.type === 'file' ? r.type : 'text',
          options: Array.isArray(r.options) ? r.options.filter((o): o is string => typeof o === 'string') : [],
          required: Boolean(r.required),
        };
      }
      return null;
    })
    .filter((r): r is ServiceRequirement => r !== null);
}

export function normalizeGallery(media: ServiceMedia[] | undefined): ServiceMediaItem[] {
  return (media ?? [])
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((m) => ({
      url: mediaUrl(m.url) ?? m.url,
      kind: m.kind === 'video' || m.kind === 'document' ? m.kind : 'image',
      fileName: m.fileName ?? '',
    }));
}

export function serializeServiceDetail(s: ServiceWithRels) {
  const media = normalizeGallery(s.media);
  return {
    ...serializeServiceSummary(s),
    gallery: media.filter((m) => m.kind === 'image').map((m) => m.url),
    media,
    video: media.find((m) => m.kind === 'video') ?? null,
    documents: media.filter((m) => m.kind === 'document'),
    description: s.description,
    serviceType: s.serviceType ?? '',
    searchTags: Array.isArray(s.searchTags) ? (s.searchTags as string[]) : [],
    deliveryDays: s.deliveryDays ?? null,
    revisions: s.revisions ?? null,
    included: s.included as string[],
    requirements: normalizeRequirements(s.requirements),
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
    image: mediaUrl(p.imageUrl),
    plan: effectivePlan(p),
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
      .map((i) => ({ id: i.id, title: i.title, category: i.category ?? '', description: i.description ?? '', image: mediaUrl(i.mediaUrl) })),
    details: normalizeProfileDetails(p.details),
  };
}

export interface ProfileDetailsShape {
  occupation: string; website: string;
  languages: { name: string; level: string }[];
  education: { school: string; degree: string; year: string }[];
  certifications: { name: string; issuer: string; year: string }[];
  experience: { title: string; company: string; start: string; end: string; description: string }[];
}
export function normalizeProfileDetails(value: unknown): ProfileDetailsShape {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const list = <T>(key: string, map: (x: Record<string, unknown>) => T): T[] =>
    Array.isArray(v[key]) ? (v[key] as unknown[]).filter((x) => x && typeof x === 'object').map((x) => map(x as Record<string, unknown>)) : [];
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  return {
    occupation: str(v.occupation),
    website: str(v.website),
    languages: list('languages', (x) => ({ name: str(x.name), level: str(x.level) })).filter((x) => x.name),
    education: list('education', (x) => ({ school: str(x.school), degree: str(x.degree), year: str(x.year) })).filter((x) => x.school),
    certifications: list('certifications', (x) => ({ name: str(x.name), issuer: str(x.issuer), year: str(x.year) })).filter((x) => x.name),
    experience: list('experience', (x) => ({ title: str(x.title), company: str(x.company), start: str(x.start), end: str(x.end), description: str(x.description) })).filter((x) => x.title),
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
    avatarUrl: mediaUrl(u.avatarUrl),
    role: u.role,
    status: u.status,
    emailVerified: u.emailVerifiedAt != null,
    createdAt: u.createdAt.toISOString(),
  };
}
