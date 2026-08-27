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
  emailMode: 'console' | 'noop';
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
    emailMode: (process.env.EMAIL_MODE as 'console' | 'noop') ?? 'console',
  };
}
