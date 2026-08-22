/**
 * SERVIX DATA LAYER — future API boundary.
 *
 * Every function in this module mirrors a planned backend endpoint:
 *
 *   getServices(params)        →  GET  /api/services
 *   getService(id)             →  GET  /api/services/:id
 *   getProfessionals(params)   →  GET  /api/professionals
 *   getProfessional(id)        →  GET  /api/professionals/:id
 *   getCategories()            →  GET  /api/categories
 *   getTestimonials()          →  GET  /api/testimonials
 *   getPricingPlans()          →  GET  /api/plans
 *   submitContact(payload)     →  POST /api/contact
 *
 * The current implementations resolve from local DEMO data with a small
 * async delay so components already handle loading states correctly.
 * When the backend ships, only this file changes — components keep the
 * same contract.
 */
import { services } from '../data/services.js';
import { professionals } from '../data/professionals.js';
import { categories } from '../data/categories.js';
import { testimonials } from '../data/testimonials.js';
import { pricingPlans } from '../data/pricingPlans.js';
import { reviews } from '../data/reviews.js';

const DEMO_DELAY = 250;

const delay = (ms = DEMO_DELAY) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------------------------- categories */
export async function getCategories() {
  await delay();
  return categories;
}

/* -------------------------------------------------- services */
export async function getServices(params = {}) {
  await delay();
  let results = [...services];

  const { query, category, minPrice, maxPrice, minRating, location, availability, sort } = params;

  if (query) {
    const q = query.toLowerCase();
    results = results.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        s.shortDescription.toLowerCase().includes(q) ||
        s.categoryId.replace(/-/g, ' ').includes(q)
    );
  }
  if (category) results = results.filter((s) => s.categoryId === category);
  if (minPrice != null) results = results.filter((s) => s.price >= minPrice);
  if (maxPrice != null) results = results.filter((s) => s.price <= maxPrice);
  if (minRating != null) results = results.filter((s) => s.rating >= minRating);
  if (location) {
    const l = location.toLowerCase();
    results = results.filter((s) => s.location.toLowerCase().includes(l));
  }
  if (availability) results = results.filter((s) => s.availability === availability);

  switch (sort) {
    case 'price-asc':
      results.sort((a, b) => a.price - b.price);
      break;
    case 'price-desc':
      results.sort((a, b) => b.price - a.price);
      break;
    case 'rating':
      results.sort((a, b) => b.rating - a.rating);
      break;
    case 'reviews':
      results.sort((a, b) => b.reviewCount - a.reviewCount);
      break;
    default:
      break; // "recommended" — original order
  }

  return { items: results, total: results.length };
}

export async function getService(id) {
  await delay();
  const service = services.find((s) => s.id === id);
  if (!service) {
    const err = new Error('Service not found');
    err.status = 404;
    throw err;
  }
  return service;
}

export async function getServiceReviews(serviceId) {
  await delay();
  return reviews.filter((r) => r.serviceId === serviceId);
}

/* -------------------------------------------------- professionals */
export async function getProfessionals(params = {}) {
  await delay();
  let results = [...professionals];

  const { query, category, location, minRating, maxPrice, availability, sort } = params;

  if (query) {
    const q = query.toLowerCase();
    results = results.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.title.toLowerCase().includes(q) ||
        p.skills.some((s) => s.toLowerCase().includes(q))
    );
  }
  if (category) results = results.filter((p) => p.categoryId === category);
  if (location) {
    const l = location.toLowerCase();
    results = results.filter((p) => p.location.toLowerCase().includes(l));
  }
  if (minRating != null) results = results.filter((p) => p.rating >= minRating);
  if (maxPrice != null) results = results.filter((p) => p.startingPrice <= maxPrice);
  if (availability) results = results.filter((p) => p.availability === availability);

  switch (sort) {
    case 'rating':
      results.sort((a, b) => b.rating - a.rating);
      break;
    case 'reviews':
      results.sort((a, b) => b.reviewCount - a.reviewCount);
      break;
    case 'price-asc':
      results.sort((a, b) => a.startingPrice - b.startingPrice);
      break;
    case 'price-desc':
      results.sort((a, b) => b.startingPrice - a.startingPrice);
      break;
    default:
      break;
  }

  return { items: results, total: results.length };
}

export async function getProfessional(id) {
  await delay();
  const pro = professionals.find((p) => p.id === id);
  if (!pro) {
    const err = new Error('Professional not found');
    err.status = 404;
    throw err;
  }
  return pro;
}

export async function getProfessionalReviews(professionalId) {
  await delay();
  return reviews.filter((r) => r.professionalId === professionalId);
}

export async function getProfessionalServices(professionalId) {
  await delay();
  return services.filter((s) => s.professionalId === professionalId);
}

/* -------------------------------------------------- misc */
export async function getTestimonials() {
  await delay();
  return testimonials;
}

export async function getPricingPlans() {
  await delay();
  return pricingPlans;
}

/**
 * Contact form submission.
 * NOTE: there is no live backend yet — this validates and stores the message
 * locally so the UI flow can be demonstrated honestly. It will become
 * `POST /api/contact` in the backend phase.
 */
export async function submitContact(payload) {
  await delay(500);
  const required = ['name', 'email', 'subject', 'message'];
  for (const field of required) {
    if (!payload[field] || !String(payload[field]).trim()) {
      const err = new Error(`Missing required field: ${field}`);
      err.status = 400;
      throw err;
    }
  }
  // Demo behaviour: message is not sent anywhere yet.
  return { ok: true, demo: true };
}
