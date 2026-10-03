/**
 * Consistent API error envelope:
 *   { "error": { "code": "...", "message": "...", "status": 404 } }
 */
export class ApiError extends Error {
  errors?: Record<string, string>;
  /** Structured, non-sensitive context for the client (e.g. plan-limit details for upgrade prompts). */
  meta?: Record<string, unknown>;
  constructor(
    public status: number,
    public code: string,
    message: string,
    errors?: Record<string, string>,
    meta?: Record<string, unknown>,
  ) {
    super(message);
    if (errors) this.errors = errors;
    if (meta) this.meta = meta;
  }
}

export const notFound = (code: string, message: string) => new ApiError(404, code, message);
export const badRequest = (message: string) => new ApiError(400, 'BAD_REQUEST', message);
export const unauthorized = (message = 'Authentication required') =>
  new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Not allowed') => new ApiError(403, 'FORBIDDEN', message);

export function validationError(errors: Record<string, string>): ApiError {
  const err = new ApiError(422, 'VALIDATION_ERROR', 'Validation failed');
  err.errors = errors;
  return err;
}
