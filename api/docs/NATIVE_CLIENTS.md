# Native clients (Android / iOS)

The cookie-based auth flows (`/auth/register`, `/auth/login`, `/auth/forgot-password`, `/auth/security/*`)
are protected by an **Origin check** (`requireSecurityOrigin` in `src/routes/security.ts`): a browser request
is accepted only when its `Origin` header is one of `CORS_ORIGINS`. That is the CSRF defence for the
`servix_refresh` / `servix_security` cookies.

Native apps have no browser origin, so they identify themselves instead:

```
X-Servix-Client: ng.name.servix.app
```

- Accepted ids come from `NATIVE_CLIENT_IDS` (comma-separated; default `ng.name.servix.app`, the Android
  application id).
- The header is honoured **only when no `Origin` header is present**. A browser cannot send this custom
  header cross-site without a CORS preflight, and preflights succeed only for trusted origins, so the guard
  remains sound for web traffic.
- Native apps must send the header on **every** request (simplest: an OkHttp interceptor) and must keep
  cookies between launches (persistent cookie jar) so `POST /auth/refresh` and the security flow work.
- Everything else is unchanged: `Authorization: Bearer <accessToken>` on authenticated routes, the same
  JSON contracts as the web app, OpenAPI at `/api/v1/docs/json`.

Test: `api/tests/native-client-origin.test.ts`.
