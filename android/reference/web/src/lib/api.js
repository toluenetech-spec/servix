/**
 * SERVIX DATA LAYER — provider facade.
 *
 *   • demoApi.js — bundled demo data (no backend required)
 *   • httpApi.js — the live Servix API
 *
 * Selection (feature flag):
 *   VITE_API_URL unset → demo data (current production behaviour)
 *   VITE_API_URL set   → live API, automatic per-call fallback to demo
 *                        data on transport failure (real API errors such
 *                        as 404s pass through untouched).
 *
 * Authentication (Phase B) intentionally does NOT use this facade —
 * see ./authApi.js: auth is either real or clearly unavailable.
 */
import * as demo from './demoApi.js';
import * as http from './httpApi.js';

const USE_API = Boolean(import.meta.env.VITE_API_URL);

function isNetworkError(err) {
  return err instanceof TypeError || err?.status === undefined;
}

function withFallback(name) {
  return async (...args) => {
    if (!USE_API) return demo[name](...args);
    try {
      return await http[name](...args);
    } catch (err) {
      if (isNetworkError(err)) {
        console.warn(`[servix] API unreachable for ${name}(); using demo data fallback.`);
        return demo[name](...args);
      }
      throw err;
    }
  };
}

export const getCategories = withFallback('getCategories');
export const getServices = withFallback('getServices');
export const getService = withFallback('getService');
export const getServiceReviews = withFallback('getServiceReviews');
export const getProfessionals = withFallback('getProfessionals');
export const getProfessional = withFallback('getProfessional');
export const getProfessionalReviews = withFallback('getProfessionalReviews');
export const getProfessionalServices = withFallback('getProfessionalServices');
export const getTestimonials = withFallback('getTestimonials');
export const getPricingPlans = withFallback('getPricingPlans');
export const getStats = withFallback('getStats');
export const submitContact = withFallback('submitContact');
