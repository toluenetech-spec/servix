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

## Device identification (sign-in alerts)

The API already records the `User-Agent` and client IP of every sign-in (`issueSession` → `alertIfNewDevice`,
`src/lib/loginAlerts.ts`) and emails the account owner when a new kind of device signs in. OkHttp's default
`okhttp/4.x` user agent would make every phone look like "Unknown browser on Unknown device", so the app sends:

```
User-Agent: ServixAndroid/<versionName> (Android <release>; <manufacturer> <model>)
```

`describeDevice` (`src/lib/deviceInfo.ts`) turns that into `Servix app on Android (<manufacturer> <model>)` and
treats each phone model as its own device for the "new device" check. No new endpoint and no new data is
collected: the IP address is the ordinary request address already used for web sign-ins (display only, never
for authorisation). Precise location is **not** sent to the API by the app.

`GET /account/device` (Bearer) echoes the same two facts for the current request — `{ ip, device, os, client,
userAgent, seenAt }` — read-only and unstored, for an honest "This device" panel in the app.

Test: `api/tests/device-info.test.ts`.

## Google / GitHub sign-in from the app (API 0.9.5)

The web flow binds the attempt to the browser with a cookie set by `POST /auth/<provider>/start` and finishes
by setting `servix_security` in that same browser. A native app has two cookie jars (its HTTP client and the
system browser / Custom Tab), so it uses the hand-off variant:

1. App opens **`GET /auth/<provider>/native/start?client=ng.name.servix.app`** in a Chrome Custom Tab
   (`client` must be in `NATIVE_CLIENT_IDS`). The API sets the binding cookie in that browser and 302s to the provider.
2. Provider → `GET /auth/<provider>/callback` as today. For native attempts the API does **not** set
   `servix_security`; it parks the new security flow behind a one-time ticket (2 min, single use, sealed in
   `oauth_attempts`) and redirects to **`NATIVE_OAUTH_REDIRECT?provider=<p>&ticket=<t>`**
   (default `ng.name.servix.app://oauth/callback`). Cancel/failure → `…?provider=<p>&error=cancelled|failed|link_required`.
3. The app catches that URI (intent filter for the scheme) and calls
   **`POST /auth/oauth/native/exchange { ticket }`** with `X-Servix-Client` → the normal `{ security }` response
   + `servix_security` cookie in the app's jar. From here the existing security-check screens apply unchanged
   (`next` = `enroll` for a brand-new account, `factor` for an enrolled one).

Nothing changes for the website. Providers available: `GET /auth/oauth/config → { providers }`.
Test: `api/tests/oauth-local.test.ts` ("native app hand-off").
