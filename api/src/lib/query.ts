/** Shared query-parameter schemas (zod), matching the frontend data layer. */
import { z } from 'zod';
import { ApiError } from './errors.js';

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
});

export const serviceQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(100).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  location: z.string().trim().max(100).optional(),
  availability: z.enum(['available', 'limited', 'unavailable']).optional(),
  sort: z.enum(['recommended', 'rating', 'reviews', 'price-asc', 'price-desc']).default('recommended'),
});

export const professionalQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(100).optional(),
  location: z.string().trim().max(100).optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  availability: z.enum(['available', 'limited', 'unavailable']).optional(),
  sort: z.enum(['recommended', 'rating', 'reviews', 'price-asc', 'price-desc']).default('recommended'),
});

export function parseQuery<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first.path.join('.');
    throw new ApiError(
      400,
      'INVALID_QUERY',
      `Invalid query parameter${path ? ` "${path}"` : ''}: ${first.message}`,
    );
  }
  return result.data;
}

/** Parse a request body; zod failures → 422 with a field→message map. */
export function parseBody<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const errors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || 'body';
      if (!errors[key]) errors[key] = issue.message;
    }
    const err = new ApiError(422, 'VALIDATION_ERROR', 'Validation failed');
    err.errors = errors;
    throw err;
  }
  return result.data;
}
