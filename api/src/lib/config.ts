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
  emailMode: 'console' | 'noop' | 'resend' | 'brevo';
}

/**
 * Email transport resolution. EMAIL_MODE is the native switch;
 * EMAIL_PROVIDER is accepted as an alias. EMAIL_MODE wins when both set.
 */
export function resolveEmailMode(env: NodeJS.ProcessEnv = process.env): Config['emailMode'] {
  const raw = env.EMAIL_MODE ?? env.EMAIL_PROVIDER ?? 'console';
  return (['console', 'noop', 'resend', 'brevo'].includes(raw) ? raw : 'console') as Config['emailMode'];
}

/**
 * Storage env alias resolution. Native names: STORAGE_PROVIDER=r2 + R2_*.
 * S3-style aliases: STORAGE_DRIVER=s3 + STORAGE_S3_*. Either configures
 * the SAME provider. Native names win. Secrets stay server-side only.
 */
export interface StorageEnv {
  enabled: boolean;
  accountId: string;
  endpointHost: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

export function resolveStorageEnv(env: NodeJS.ProcessEnv = process.env): StorageEnv {
  const s3Endpoint = env.STORAGE_S3_ENDPOINT ?? '';
  let endpointHost = '';
  let accountFromEndpoint = '';
  if (s3Endpoint) {
    try {
      endpointHost = new URL(s3Endpoint).host;
      accountFromEndpoint = endpointHost.split('.')[0] ?? '';
    } catch {
      /* invalid URL reported by validateProductionConfig */
    }
  }
  const accountId = env.R2_ACCOUNT_ID ?? accountFromEndpoint;
  if (!endpointHost && accountId) endpointHost = `${accountId}.r2.cloudflarestorage.com`;

  const enabled =
    env.STORAGE_PROVIDER === 'r2' || env.STORAGE_DRIVER === 's3';

  return {
    enabled,
    accountId,
    endpointHost,
    region: env.STORAGE_S3_REGION ?? 'auto',
    bucket: env.R2_BUCKET ?? env.STORAGE_S3_BUCKET ?? '',
    accessKeyId: env.R2_ACCESS_KEY_ID ?? env.STORAGE_S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? env.STORAGE_S3_SECRET_ACCESS_KEY ?? '',
    publicBaseUrl: env.R2_PUBLIC_BASE_URL ?? env.STORAGE_PUBLIC_BASE_URL ?? '',
  };
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
    emailMode: resolveEmailMode(),
  };
}

/**
 * Phase E: production refuses to start with missing/weak configuration.
 * Returns the list of fatal problems (empty = OK).
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

  const emailMode = resolveEmailMode(env);
  if (emailMode === 'console' || emailMode === 'noop') {
    problems.push('EMAIL_MODE=console/noop is not a production transport (set brevo + BREVO_API_KEY, or resend + RESEND_API_KEY)');
  }
  if (emailMode === 'resend' && !env.RESEND_API_KEY) problems.push('RESEND_API_KEY missing');
  if (emailMode === 'brevo') {
    if (!env.BREVO_API_KEY) problems.push('BREVO_API_KEY missing (EMAIL_MODE=brevo)');
    if (!env.EMAIL_FROM_EMAIL && !env.EMAIL_FROM) {
      problems.push('EMAIL_FROM_EMAIL (or EMAIL_FROM) missing (EMAIL_MODE=brevo)');
    }
  }

  const storage = resolveStorageEnv(env);
  if (storage.enabled) {
    if (!storage.accountId) problems.push('R2 account id missing (set R2_ACCOUNT_ID or a valid STORAGE_S3_ENDPOINT)');
    if (!storage.accessKeyId) problems.push('R2_ACCESS_KEY_ID / STORAGE_S3_ACCESS_KEY_ID missing');
    if (!storage.secretAccessKey) problems.push('R2_SECRET_ACCESS_KEY / STORAGE_S3_SECRET_ACCESS_KEY missing');
    if (!storage.bucket) problems.push('R2_BUCKET / STORAGE_S3_BUCKET missing');
    if (!storage.publicBaseUrl) {
      problems.push('R2_PUBLIC_BASE_URL / STORAGE_PUBLIC_BASE_URL missing (public bucket URL required for image retrieval)');
    }
  }

  if (env.SERVIX_REVIEW_KEY === 'dev-review-key') {
    problems.push('SERVIX_REVIEW_KEY still set to dev default');
  }
  if (!env.ADMIN_EMAIL) problems.push('ADMIN_EMAIL missing (admin bootstrap)');
  return problems;
}
