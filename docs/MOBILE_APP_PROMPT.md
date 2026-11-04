# Servix Android app — prompt for Google AI Studio (Build → Android)

Paste everything below the line into the Android app builder in Google AI Studio as the first prompt.
The app is a **native client** for the existing Servix API — it does not replace the website or the backend.

---

Build a native Android app called **Servix** — a client for the existing Servix marketplace API. Servix is a Nigeria-first platform where customers find identity-verified professionals, book them at a locked price with the payment held until they confirm the work, and get help from "Servix AI".

## Non-negotiable rules
1. The backend already exists. Base URL: `https://api.servix.name.ng/api/v1`. Full OpenAPI 3.1 spec: `https://api.servix.name.ng/api/v1/docs/json` (human view: `/api/v1/docs`). Use real endpoints only; never invent endpoints, fields or data. Do not add Firestore or any second backend — all data lives in the Servix API.
2. Version 1 is a **customer** app: browse, search, view professionals and services, book and pay, track bookings, confirm/cancel/dispute/review, chat with Servix AI, manage account. Professionals and admins keep using the website; show a "Professional tools are on www.servix.name.ng" card if a signed-in user has role `professional` or `admin`.
3. Never hard-code secrets or API keys in the app. The API needs none from the client.
4. Do not claim features the API does not provide. Community, Messages and Network are **disabled** — do not build them.
5. Respect the design system exactly (below). No gradients, no neon, no generic purple. Calm, editorial, premium.
6. Money is always shown as Nigerian Naira with the ₦ symbol and thousands separators (₦350,000). Amounts from the API are already in Naira unless the field name ends in `Kobo`.

## Design system (Servix brand)
- Colours: Deep Forest `#12372A` (primary, headers, primary buttons), Forest Green `#1F5C45` (secondary), Warm Ivory `#F7F4EC` (app background), Soft Sand `#EDE8DC` (surfaces/dividers), Coral `#E56B5D` (accent — use sparingly for alerts/highlights), Charcoal `#202622` (text), Muted Gray `#68716B` (secondary text), White for cards.
- Typography: Inter (bundle Inter from Google Fonts). Headings bold, tight letter-spacing; body 16sp.
- Shapes: 1dp borders in Soft Sand, corner radius 10dp for cards and 6dp for inputs/buttons. Buttons: filled Deep Forest with Warm Ivory text; secondary buttons outlined.
- Material 3 with a custom light colour scheme built from the colours above. Dark mode optional later.
- App icon: a Deep Forest rounded square with an ivory "SX" monogram (reproduce; the official PNG is at `https://www.servix.name.ng/brand/servix-app-logo.png`).
- Tone of copy: short, plain English, confident, no exclamation marks.

## Authentication (JWT access token + refresh cookie)
- `POST /auth/register` body `{ fullName, email, password }` → `201 { user, accessToken }`. Password rules: ask `POST /auth/reset-password/policy` or simply require min 8 chars and show the server's validation message on 400/422.
- `POST /auth/login` body `{ email, password }` → `{ user, accessToken }`. The response also sets an **httpOnly refresh cookie**; use OkHttp with a **persistent CookieJar** so the cookie is stored and sent back.
- `POST /auth/refresh` (no body; cookie is sent automatically) → `{ accessToken }`. Call it when a request returns 401, then retry once; if refresh fails, sign the user out.
- `GET /me` → current user (`id, fullName, email, role, status, emailVerified…`). `POST /auth/logout` clears the session.
- Email verification: `GET /auth/verification-method` returns `{ method: 'otp' | 'link' }`. When `otp`, after registration show a 6-digit code screen and call `POST /auth/verify-email/code` `{ code }` (Bearer token required); `POST /auth/verify-email/resend` to resend.
- Send `Authorization: Bearer <accessToken>` on all authenticated calls. Keep the access token in memory + EncryptedSharedPreferences.
- Google sign-in exists on the website via browser OAuth; **skip it in v1** (email + password only) rather than inventing a flow.
- Password reset: `POST /auth/forgot-password` `{ email }` (always shows a neutral "if the address exists we emailed you" message).

## Public catalogue (no auth)
- `GET /categories` → category list `{ slug, name, description, … }`.
- `GET /professionals?q=&category=&location=&sort=recommended|rating|price_asc|price_desc|newest&page=1&pageSize=20` → `{ items, total, page, pageSize }`. Items include `slug, name, title, city, category, rating, reviews, verified, completedProjects, fromPrice, photoUrl`.
- `GET /professionals/:slug` → full profile; `GET /professionals/:slug/services`; `GET /professionals/:slug/reviews`.
- `GET /services?…` and `GET /services/:slug` → gig details (`title, description, price, deliveryDays, gallery, faqs, professional`); `GET /services/:slug/reviews`; `GET /services/:slug/availability` → bookable time slots.
- Image URLs are absolute; load them with Coil.
- Show the catalogue's own labels honestly (the API may mark profiles as demonstration content; keep that label visible).

## Booking and payment (auth required)
- Create: `POST /bookings` body `{ serviceId: <service slug>, scheduledAt: ISO-8601 date-time, notes? }` → booking object with `id, reference (SVX-…), status, amount, scheduledAt, professional, service`.
- Pay: `POST /bookings/:id/pay` → `{ authorizationUrl, reference }`. Open `authorizationUrl` in a **Chrome Custom Tab** (Paystack hosted checkout). When the user returns to the app, poll `GET /bookings/:id` every 2 s for up to 60 s until `status` changes from the pending-payment state, then show the result. Never collect card details inside the app.
- List and detail: `GET /bookings` (customer's bookings), `GET /bookings/:id` (includes status history/events).
- Actions, each `POST /bookings/:id/<action>`: `cancel` `{ reason? }`, `confirm` (customer confirms completion → releases payment), `dispute` `{ reason (≥10 chars) }`, `review` `{ rating 1–5, comment }`, `rebook` (creates a new draft booking from an old one).
- Statuses are server-defined (requested, accepted, in progress, delivered, completed, cancelled, disputed, refunded…). Render whatever string the API returns with a neutral chip; only enable action buttons the API allows — if an action returns 409/422, show the server's message.
- Copy that must appear on the booking screen (verbatim): "The price is locked when you book. Payment is held securely and only released after you confirm completion."

## Servix AI (auth required)
- Streaming chat: `POST /ai/assistant/stream` body `{ messages: [{ role: 'user' | 'assistant', content }] }` (send the conversation so far). Response is **Server-Sent Events**: lines `data: {json}` with `{"type":"start"}`, `{"type":"delta","text":"…"}` (append), `{"type":"done","answer":"…"}`, `{"type":"error","code","message","status"}`. Use OkHttp with a streaming response body and render Markdown (bold, bullet lists) in the answer bubble.
- Non-streaming fallback: `POST /ai/assistant` same body → `{ answer, … }`.
- Feedback: `POST /ai/feedback` `{ rating: 'up' | 'down', comment?, prompt?, answer? }`. Show thumbs up/down and a Copy button under each answer.
- Usage/quota: `GET /ai/usage`. If a request returns 403 with code `AI_QUOTA_EXCEEDED` or `PLAN_FEATURE`, show "Your plan's AI allowance is used up for this month — upgrade on www.servix.name.ng" (plans are managed on the website in v1).
- Always show this disclaimer under the chat (verbatim): "AI suggestions are drafts — check them before you rely on them. Servix AI never moves money or changes your bookings."

## Account (auth required)
- `GET /account/overview` (dashboard summary), `GET /account/notifications`, `GET /account/notifications/unread`, `POST /account/notifications/read` `{ ids? }`, `GET /account/payments` (payment history), `GET /account/saved` / `POST /account/saved` `{ slug }` / `DELETE /account/saved/:slug` (saved professionals), `PATCH /account/profile` `{ fullName, phone?, city? }`, `GET /me/entitlements` (plan + limits; read-only in v1).

## Screens (bottom navigation: Home · Search · Bookings · Servix AI · Account)
1. **Onboarding/Sign in** — hero copy "Services, delivered professionally.", Sign in / Create account, forgot password, OTP screen.
2. **Home** — greeting, search bar, category chips, "Top-rated professionals" horizontal list (from `/professionals?sort=rating`), "Your next booking" card if any.
3. **Search** — results list with filters (category, location, sort); pull-to-refresh; empty state.
4. **Professional profile** — photo, name, title, city, Verified badge (only when `verified` is true), rating/reviews/completed projects, About, Services list, Reviews.
5. **Service detail** — gallery, price (₦), delivery days, description, FAQs, "Request Booking" → bottom sheet: pick time slot from `/services/:slug/availability`, notes, then "Book & Pay ₦…".
6. **Bookings** — tabs Active / Past; detail screen with reference, status chip, timeline, amount, scheduled date/time (Africa/Lagos), professional, notes, and the allowed actions.
7. **Servix AI** — chat with streaming answers, Copy, Helpful? 👍/👎, suggested prompts ("Who can design a logo for a small bakery in Lagos?", "How much does a brand identity package cost?").
8. **Account** — profile, saved professionals, payments, notifications, plan (read-only), sign out, links to Privacy and Terms on www.servix.name.ng.

## Technical requirements
- Kotlin, Jetpack Compose, Material 3, single-activity with Navigation Compose; MVVM with ViewModels and a repository layer; Retrofit/OkHttp + kotlinx.serialization (or Moshi); Coil for images; Kotlin coroutines/Flow; EncryptedSharedPreferences for the token; persistent OkHttp CookieJar for the refresh cookie.
- Robust network UX: loading skeletons, error states with Retry, offline banner, pull-to-refresh. Map API error bodies `{ error, message }` to user-facing messages.
- Dates: parse ISO-8601, display in the device locale with Africa/Lagos time zone.
- Accessibility: content descriptions, 48dp touch targets, dynamic text support.
- minSdk 26, targetSdk latest. Internet permission only (no location/contacts).
- Add a small "About" entry showing app version and "API: api.servix.name.ng".

Start by generating the project skeleton with the theme, navigation and the auth flow wired to the real API, then the catalogue screens, then bookings, then Servix AI, then Account. After each stage, run it in the emulator against the live API and fix any mismatch with the OpenAPI spec before moving on.
