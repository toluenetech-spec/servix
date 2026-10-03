import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchFiltersToParams, describeSearchFilters, requestDraftToForm, proposalDraftToForm, aiErrorMessage, HEALTH_LABELS } from '../src/lib/aiHelpers.js';

test('search filters map to the professionals page URL params', () => {
  assert.deepEqual(searchFiltersToParams({ q: 'logo designer', category: 'graphic-design', location: 'Lagos', maxPrice: 30000, sort: 'recommended' }), { q: 'logo designer', category: 'graphic-design', location: 'Lagos', price: '150' });
  assert.deepEqual(searchFiltersToParams({ maxPrice: 200000, available: 'week', sort: 'rating' }), { price: '250', availability: 'week', sort: 'rating' });
  assert.deepEqual(searchFiltersToParams({ maxPrice: 900000 }), { price: '900000' });
  assert.deepEqual(searchFiltersToParams({}), {});
  assert.deepEqual(searchFiltersToParams({ maxPrice: -5, q: '' }), {});
});

test('describeSearchFilters produces readable chips using real category names', () => {
  const chips = describeSearchFilters({ category: 'graphic-design', location: 'Lagos', maxPrice: 30000, available: 'week' }, [{ id: 'graphic-design', name: 'Graphic Design' }]);
  assert.deepEqual(chips, ['Graphic Design', 'Lagos', 'Up to ₦30,000', 'Free this week']);
  assert.deepEqual(describeSearchFilters({}), []);
  assert.deepEqual(describeSearchFilters({ category: 'web-development' }), ['Web Development']);
});

test('request draft fills the editor form without losing untouched fields', () => {
  const form = requestDraftToForm({ title: 'Restaurant website', categorySlug: 'web-development', description: 'Menu + WhatsApp ordering, mobile first, five pages.', budgetType: 'range', budgetMin: 150000, budgetMax: 250000, deadlineAt: '2026-11-30T12:00:00.000Z', isRemote: true, location: null, requiredSkills: ['react', 'seo'] }, { extraRequirements: 'keep me', title: 'old' });
  assert.equal(form.title, 'Restaurant website');
  assert.equal(form.budgetType, 'range');
  assert.equal(form.budgetMin, '150000');
  assert.equal(form.budgetMax, '250000');
  assert.equal(form.deadlineAt, '2026-11-30');
  assert.equal(form.isRemote, true);
  assert.equal(form.requiredSkills, 'react, seo');
  assert.equal(form.extraRequirements, 'keep me');
  const fixed = requestDraftToForm({ title: 'x', budgetType: 'fixed', budgetMax: 80000, budgetMin: null, deadlineAt: null, isRemote: false, location: 'Ikeja' });
  assert.equal(fixed.budgetType, 'fixed'); assert.equal(fixed.budgetMin, ''); assert.equal(fixed.budgetMax, '80000'); assert.equal(fixed.deadlineAt, ''); assert.equal(fixed.location, 'Ikeja'); assert.equal(fixed.isRemote, false);
});

test('proposal draft fills the proposal form, milestones as editor lines', () => {
  const form = proposalDraftToForm({ cover: 'Hello, here is how I would do it.', price: 90000, deliveryDays: 6, serviceSlug: 'logo-design', milestones: [{ title: 'Concepts', amount: 40000, days: 3 }, { title: 'Final files' }] }, { cover: 'old' });
  assert.equal(form.cover, 'Hello, here is how I would do it.');
  assert.equal(form.price, '90000'); assert.equal(form.deliveryDays, '6'); assert.equal(form.serviceSlug, 'logo-design');
  assert.equal(form.milestones, 'Concepts | 40000 | 3\nFinal files');
  assert.equal(proposalDraftToForm({ cover: 'c', price: 1000, deliveryDays: 1, serviceSlug: null }).serviceSlug, '');
});

test('controlled AI errors become plain-language copy with no provider details', () => {
  assert.match(aiErrorMessage({ code: 'AI_UNAVAILABLE', status: 503, message: 'upstream 429 model_concurrency from inference.dahl.global' }), /busy/);
  assert.doesNotMatch(aiErrorMessage({ code: 'AI_UNAVAILABLE', status: 503, message: 'upstream dahl' }), /dahl/i);
  assert.match(aiErrorMessage({ code: 'AI_TIMEOUT', status: 504 }), /too long/);
  assert.match(aiErrorMessage({ code: 'AI_INVALID_OUTPUT', status: 502 }), /usable answer/);
  assert.match(aiErrorMessage({ code: 'FEATURE_DISABLED', status: 503 }), /switched off/);
  assert.match(aiErrorMessage({ status: 429 }), /wait a minute/);
  assert.match(aiErrorMessage({ status: 403 }), /professionals/);
  assert.equal(aiErrorMessage({ code: 'VALIDATION_ERROR', status: 422, errors: { categorySlug: 'Choose a real Servix category.' } }), 'Choose a real Servix category.');
  assert.equal(aiErrorMessage(null), 'Servix AI could not complete that. Please try again.');
});

test('every backend health status has a label', () => {
  for (const s of ['awaiting_payment', 'awaiting_acceptance', 'on_track', 'at_risk', 'late', 'delivered', 'completed', 'disputed', 'cancelled', 'refunded', 'declined']) assert.ok(HEALTH_LABELS[s]?.label, s);
});
