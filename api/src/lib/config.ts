/** Environment configuration. */
export interface Config {
  port: number;
  host: string;
  corsOrigins: string[];
  nodeEnv: string;
  authJwtSecret: string;
  accessTtlMin: number;
  refreshTtlDays: number;
  appBaseUrl: string;
  emailMode: 'console' | 'noop' | 'resend';
}

export function loadConfig(): Config {
  const secret = process.env.AUTH_JWT_SECRET ?? '';
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('AUTH_JWT_SECRET must be set (>=32 chars) in production');
  }
  return {
    port: Number(process.env.PORT ?? 8080),
    host: process.env.HOST ?? '0.0.0.0',
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    authJwtSecret: secret || 'dev-only-secret-change-me-in-production-0123456789abcdef',
    accessTtlMin: Number(process.env.AUTH_ACCESS_TTL_MIN ?? 15),
    refreshTtlDays: Number(process.env.AUTH_REFRESH_TTL_DAYS ?? 30),
    appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:5173',
    emailMode: (process.env.EMAIL_MODE as 'console' | 'noop' | 'resend') ?? 'console',
  };
}

/**
 * Phase E: production refuses to start with missing/weak configuration.
 * Returns the list of fatal problems (empty = OK). Called at boot;
 * throwing is the server's job so tests can assert the list.
 */
export function validateProductionConfig(env = process.env): string[] {
  const problems: string[] = [];
  if (env.NODE_ENV !== 'production') return problems;

  if (!env.AUTH_JWT_SECRET || env.AUTH_JWT_SECRET.length < 32) {
    problems.push('AUTH_JWT_SECRET missing or shorter than 32 characters');
  }
  if (!env.DATABASE_URL) problems.push('DATABASE_URL missing');
  if (!env.PAYSTACK_SECRET_KEY) problems.push('PAYSTACK_SECRET_KEY missing (live payments required in production)');
  if (!env.APP_BASE_URL?.startsWith('https://')) problems.push('APP_BASE_URL must be https in production');
  if ((env.EMAIL_MODE ?? 'console') === 'console') {
    problems.push('EMAIL_MODE=console is not a production transport (set resend + RESEND_API_KEY)');
  }
  if (env.EMAIL_MODE === 'resend' && !env.RESEND_API_KEY) problems.push('RESEND_API_KEY missing');
  if (env.STORAGE_PROVIDER === 'r2') {
    for (const k of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL']) {
      if (!env[k]) problems.push(`${k} missing (STORAGE_PROVIDER=r2)`);
    }
  }
  // Bridge removed in Phase E, but if present it must not be the dev value.
  if (env.SERVIX_REVIEW_KEY === 'dev-review-key') {
    problems.push('SERVIX_REVIEW_KEY still set to dev default');
  }
  if (!env.ADMIN_EMAIL) problems.push('ADMIN_EMAIL missing (admin bootstrap)');
  return problems;
}
