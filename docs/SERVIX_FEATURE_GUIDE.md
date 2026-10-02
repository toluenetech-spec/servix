# Servix — Complete Feature & Page Guide

_Built from the code as deployed on 2 October 2026 (commit `3a47f87`). Website: https://www.servix.name.ng · API: https://api.servix.name.ng_

Servix is a Nigerian marketplace for professional services. Customers discover, compare and book professionals; professionals publish "gigs", manage bookings and get paid; the Servix team runs everything from an admin console. Prices are in Naira; payments go through Paystack (currently in TEST mode); files are stored on Cloudflare R2; emails are sent by Brevo.

---

## 1. The three kinds of users

| Role | How you become one | What you get |
|---|---|---|
| **Customer** | Create an account | Browse, book, pay, message, review, save professionals |
| **Professional** | Customer who applies and is approved by an admin | Everything a customer has **plus** a business workspace: gigs, client bookings, availability, analytics, reviews, earnings & payouts, profile & portfolio, Servix Pro plan |
| **Administrator** | Set up by the platform (`ADMIN_EMAIL`) | Admin console: applications, users, services, bookings & disputes, payouts, plan subscriptions, notifications, audit log, analytics |

A professional can still book other people's services ("Bookings I made").

---

## 2. Public pages (no account needed)

| Page | Address | What's on it |
|---|---|---|
| **Home** | `/` | Hero "Services, delivered professionally.", live platform stats (verified professionals, completed services, categories, satisfaction), the 4-step "Discover → Compare → Book → Get it done", featured categories, featured services, featured professionals, why-Servix cards, final call-to-action |
| **Browse Services** | `/services` | Search box, category filter, price bands (Under ₦150k … Over ₦500k), rating (4.5+/4.8+), availability, sort (Recommended / Highest rated / Most reviewed / Price low→high / high→low), pagination |
| **Service detail (gig page)** | `/services/:slug` | Gallery (images, optional video, PDF documents), price, delivery time, revisions, service type, search tags, "About this service", "What's included", "What the professional needs from you" (buyer requirements), FAQ, availability preview, reviews, "Book" button |
| **Find Professionals** | `/professionals` | Search, category, rating, starting price, availability, sort, pagination |
| **Professional profile** | `/professionals/:slug` | Photo, title, location, rating, About, Skills, Experience, Education, Certifications, Languages/Website ("More"), Portfolio with images, Services list, Reviews, Save/connect actions |
| **For Professionals** | `/professionals/join` | Why join (customers come to you, storefront, bookings, verification, analytics, reputation), the 4 steps (Apply → Build profile → Get verified → Go live), CTA |
| **How It Works** | `/how-it-works` | Customer journey (Discover, Compare, Book, Complete, Review) and professional journey (Create profile, List services, Receive bookings, Deliver, Grow) |
| **Pricing** | `/pricing` | Free / Servix Pro / Business plans with features (see §7) |
| **About** | `/about` | Mission, values, team placeholder |
| **Contact** | `/contact` | Contact form, support / professionals emails |
| **Privacy Policy** | `/privacy` | NDPA-aware privacy policy + "Contact the operator" |
| **Terms of Service** | `/terms` | |
| **Cookie Policy** | `/cookies` | Cookie banner: "Essential only" vs "Allow optional" (cookieless Vercel analytics only with consent); re-openable from "Cookie settings" |
| **404** | anything else | "Page not found" |

Every public page has share/social metadata (Open Graph) and a crawler-readable fallback.

---

## 3. Account & sign-in pages

| Page | Address | What happens |
|---|---|---|
| **Create account** | `/register` | Full name, email, password + confirm password; live password checklist (min 8 chars, letters, numbers, symbols, not common); then email verification |
| **Verify email** | `/verify-email` | Enter the 6-digit code emailed to you (10-minute expiry, resend available) or follow the link |
| **Sign in** | `/login` | Email + password, or **Continue with Google / GitHub** (only if already linked to the account) |
| **Security check** | `/security-check` | Step-up flow after sign-in when required: email code → choose a security method (Google Authenticator app **or** a passkey) → verify → save recovery codes. Also used for sign-in with a connected provider and for password resets (with the same live checklist) |
| **Connected sign-in** | `/connected-sign-in` | Lands here after Google/GitHub; completes the security check |
| **Forgot password** | `/forgot-password` | Emails a reset link/code |
| **Choose a new password** | `/reset-password` | New password + confirm, same checklist as registration (minimum 8) |

Sessions: short-lived access token + refresh cookie; expired tokens are renewed automatically in the background (no more "Invalid or expired token" interruptions).

---

## 4. Customer workspace (`/dashboard`)

All dashboard pages share a sidebar, a top search bar ("Search services and professionals…"), a security shortcut, a notification bell with dropdown, your avatar (links to Settings), and a footer. Sidebar sections for a customer: **Workspace** (Overview, My bookings, Saved professionals, Messages, My network, Payments, Notifications) and **Account** (Become a professional / My professional application, Verification, Settings).

| Page | Address | What's on it |
|---|---|---|
| **Overview** | `/dashboard` | "Welcome back"; first-visit chooser **"How would you like to use Servix?"** (book services or apply as a professional); reminder to verify email; last-30-days activity (spending, upcoming bookings) from real records; shortcuts |
| **My bookings** | `/bookings` | All bookings with status chips: Awaiting payment, Requested, Accepted, In progress, Delivered — confirm within 3 days, Completed, Cancelled, Declined (refunded), Refunded, In dispute |
| **Booking detail** | `/bookings/:id` | Timeline, amounts, pay now (Paystack), cancel (with refund policy shown), confirm delivery, **report a problem** (opens a dispute), **review this service** (stars + text) after completion |
| **Saved professionals** | `/dashboard/saved` | Bookmarked professionals |
| **Messages** | `/dashboard/messages` | Text-only conversations tied to a booking or an accepted connection; polls while open. _Community features are currently switched off in production (`COMMUNITY_ENABLED=false`), so this shows "not enabled yet"._ |
| **My network** | `/dashboard/network` | Send/accept/decline/remove/block connection requests (same flag as Messages) |
| **Payments** | `/dashboard/payments` | Transaction history (latest 100), CSV download, plain-language notes (not tax invoices; card details never stored) |
| **Notifications** | `/dashboard/notifications` | Full list, mark read; types include booking updates, payouts, plan activation, chat, admin announcements |
| **Explore / Search** | `/dashboard/search?q=` | Searches services and professionals from the top bar |
| **Verification & security** | `/dashboard/verification` | Email ownership status, account security (authenticator/passkey, recovery codes guidance), connected providers, professional approval status |
| **Settings** | `/dashboard/settings` | **Profile photo** (upload JPEG/PNG/WebP ≤5 MB, remove), Personal details (name), Sign-in & security (Google/GitHub connections), Privacy preferences (optional analytics), Account assistance (closure/correction via support) |
| **Become a professional** | `/professionals/apply` | See §5 |

---

## 5. Becoming a professional (onboarding)

`/professionals/apply` — a full-screen, Fiverr-style flow (outside the normal dashboard chrome, with an Exit link and a sticky Continue bar).

1. **Overview** — "Grow your brand. Work with clients across Nigeria." Two choices:
   - **Upload your experience** (recommended, ~8 min): drop a LinkedIn profile PDF (step-by-step instructions shown) or "No LinkedIn? Upload your CV instead". The PDF is read on the server and **pre-fills** title, about, city, website, skills, languages, certifications, education and experience; it is also **attached for the admin** to review. Non-PDFs are refused before upload.
   - **Fill out manually** (~15 min).
2. **Personal info** — profile photo, professional title, about, city, website, languages (with level).
3. **Professional info** — category, skills (tags), experience (job title, company, from/to, what you did), education (school, degree, year), certifications (name, issuer, year).
4. **Portfolio** — portfolio items (title, category, image).
5. **Review & submit** — summary; "Submit application".

A draft is saved on the server every time you press Continue, so you can leave and come back. After submitting, the same address shows status: **Under review**, **Approved** (go to workspace) or **Not approved** (admin feedback shown; you can resubmit).

---

## 6. Professional workspace

When approved, the sidebar changes to **Business** (Overview, Client bookings, My gigs, Availability, Analytics, Reviews, Earnings & payouts, Profile & portfolio), **Workspace** (Messages, My network, Notifications, Bookings I made, Saved professionals, Payments) and **Account** (Upgrade to Servix Pro / Servix Pro plan, Verification, Settings).

| Page | Address | What's on it |
|---|---|---|
| **Overview** | `/dashboard` | Last-30-days metrics calculated from your own bookings, ledger and reviews (completed jobs, revenue credited, rating), upcoming work |
| **Client bookings** | `/dashboard/work` | Requests from customers: **Accept / Decline**, **Start work**, **Deliver**, cancel; filters by status (New request, Accepted, In progress, Delivered, Completed, Declined, Cancelled, Disputed, Refunded) |
| **My gigs** | `/dashboard/gigs` | Your services with status (Draft / Published), category, "N steps left" chip for incomplete drafts, actions: View public page, Publish / Unpublish, Edit, Remove. "Create a gig" opens the wizard |
| **Gig wizard** | `/dashboard/gigs/new`, `/dashboard/gigs/:id/edit` | Six steps, each saved on "Save & Continue" (or "Save & exit"): **Overview** (title "I will…", category, service type, up to 5 search tags) → **Pricing** (one price ≥ ₦1,000, price unit, delivery time 1–90 days, revisions 0–20, remote/on-site, location) → **Description & FAQ** (short description ≤200, full description ≤5,000, what's included, FAQs) → **Requirements** (questions the buyer must answer before booking: free text / multiple choice / file, required flag, preset questions like "What is your deadline?") → **Gallery** (up to 5 images ≤5 MB, one video ≤50 MB, up to 2 PDFs ≤10 MB) → **Publish** (checklist of anything still missing; "Publish gig"). The server refuses to publish incomplete gigs and tells you exactly what's missing |
| **Availability** | `/dashboard/availability` | Weekly hours per weekday (default Mon–Fri 09:00–17:00) and **Days off** (block specific dates). Customers only see bookable 1-hour slots |
| **Analytics** | `/dashboard/analytics` | Period selector; bookings, revenue (completed, after fees), distinct customers, published listings, rating, per-service performance with charts. _Full analytics are a Servix Pro feature; Free shows the basics_ |
| **Reviews** | `/dashboard/reviews` | Average rating and every review left on your services |
| **Earnings & payouts** | `/dashboard/earnings` | Ledger: pending vs payable balance, platform fee, **Request payout**, payout history (paid / failed with retry by admin) |
| **Profile & portfolio** | `/dashboard/profile` | Public profile editor: photo, title, about, city, website, languages, experience, education, certifications, skills, portfolio images |
| **Servix Pro plan** | `/dashboard/plan` | Current plan, limits and usage, upgrade via Paystack, plan payment history. Plans never auto-renew |

Listing limits: **Free 2 gigs · Servix Pro 10 gigs · Business unlimited** (Business is arranged offline, not purchasable online).

---

## 7. Plans (Servix Pro)

| Plan | Price | Listings | Analytics |
|---|---|---|---|
| Free | ₦0 | 2 | Basic |
| **Servix Pro** | ₦15,000 / 30 days | 10 | Full |
| Business | contact Servix | unlimited | Full |

A plan activates only after Paystack confirms the charge (return verification or signed webhook). Expiry drops the account back to Free automatically.

---

## 8. Booking, payment and money rules

**Lifecycle:** Awaiting payment → Requested → Accepted → In progress → Delivered → Completed (customer confirms, or **auto-confirmed 3 days** after delivery). Side exits: Declined (full refund), Cancelled, Disputed → admin resolves as **release** (pay the professional) or **refund**.

**Refund policy (built in, never chosen by the client):**
- Professional declines or cancels → 100 % refund.
- Customer cancels while Requested → 100 %.
- Customer cancels after Accepted but before work → configurable (default 100 %).
- Once work is In progress / Delivered → no unilateral cancellation; use "Report a problem".

**Platform fee:** default 10 % of each booking (configurable), taken when funds are released. Every movement is recorded in a double-entry ledger; all transitions are atomic so webhooks replays can't duplicate money. Booking references look like `SVX-2026-XXXXXXXX`.

**Payments:** Paystack (TEST mode today — use Paystack test cards; no real money moves). Servix never stores card details.

**Background jobs** (PostgreSQL-backed queue inside the API, no Redis): email sending, booking auto-confirm (every 10 min), payout retries, webhook retries, daily orphan cleanup.

---

## 9. Admin console (`/admin`, administrators only)

Tabs: **Overview** (pending applications, open disputes, failed payouts, dead jobs, active services, bookings by status) · **Analytics & charts** (GMV captured, platform revenue, professionals on paid plans, services with bookings, trends) · **Applications** (each card shows photo, title, about, skills, experience/education/certifications, portfolio, **CV link**; Approve / Reject with reason) · **Users** (search, suspend/reactivate, reset password — basic 8–200 chars) · **Services** (feature / unpublish / remove) · **Bookings & disputes** (view, resolve: release or refund with note) · **Payouts** (retry failed) · **Plan subscriptions** · **Send notification** (in-app broadcast to all / customers / professionals / one account; no email or SMS) · **Audit log** (who did what, when).

The admin account `admin@servix.app` is bootstrapped from configuration; admins are exempt from the live password checklist on resets.

---

## 10. Notifications

In-app bell + `/dashboard/notifications`. Generated for: booking events (requested, paid, accepted, declined, delivered, completed, cancelled, disputed, resolved), payouts (paid / failed), plan activated, chat messages, admin broadcasts. Transactional **emails** (Brevo): verification codes, password reset, security codes, booking/payment receipts. Note: Gmail sometimes defers Brevo's shared IP, so codes can arrive a few minutes late.

---

## 11. Files & uploads

Single upload endpoint with strict rules (visible at `/api/v1/uploads/rules`):

| Kind | Allowed | Max |
|---|---|---|
| profile / portfolio / service image / avatar | JPEG, PNG, WebP | 5 MB |
| resume (CV/LinkedIn) / service document | PDF | 10 MB |
| service video | MP4, WebM, MOV | 50 MB |

Files go to Cloudflare R2 (`servix-storage`). The API only accepts media URLs that belong to its own bucket. If storage is ever unavailable the UI shows a clear "uploads unavailable" message instead of failing silently.

---

## 12. Security & privacy

- Passwords hashed with scrypt; access tokens 15 min with silent refresh; refresh tokens rotated.
- Email OTP on registration; optional/step-up MFA with **Google Authenticator (TOTP)** or **passkeys (WebAuthn)**, plus recovery codes.
- Google and GitHub OAuth (sign in only if linked; linking from Settings).
- Rate limiting on auth and sensitive routes; CORS allow-list; audit log of admin and money actions.
- Cookie consent (essential vs optional analytics); NDPA-aware privacy policy; no third-party trackers without consent.
- Health endpoints: `/healthz` (liveness) and `/readyz` (database, queue, storage).

---

## 13. Technical footprint (for whoever maintains it)

- **Frontend:** React + Vite, React Router, lazy-loaded pages, shared UI kit (`src/components/ui`), served by Vercel (`www.servix.name.ng`).
- **API:** Node 22 + Fastify + Prisma 7 on Railway (`api.servix.name.ng`), PostgreSQL on Neon (Ohio), Swagger docs at `/docs`.
- **Database migrations:** 11, applied manually (never at start-up); guarded Neon scripts live in `api/docs/`.
- **Tests:** 106 API tests (embedded Postgres), 14 unit tests, 44 Playwright browser tests.
- **Categories seeded:** Web Development, UI/UX Design, Graphic Design, Video Editing, Photography, Marketing, Writing, Consulting.

### API endpoints (all under `/api/v1`)

- **Auth:** `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/verify-email`, `/auth/verify-email/code`, `/auth/verify-email/resend`, `/auth/forgot-password`, `/auth/reset-password`, `/auth/reset-password/policy`; `GET /auth/verification-method`, `GET /me`
- **Security (MFA):** `GET /auth/security/config`; `POST /auth/security/status | email/verify | email/resend | totp/setup | totp/enroll | totp/verify | passkey/options | passkey/verify | recovery/codes | recovery/verify | reset-password | finish | cancel`
- **OAuth:** `GET /auth/oauth/config`, `GET /auth/oauth/connections`, `POST /auth/{google|github}/start|link`, `GET /auth/{provider}/callback`
- **Account:** `GET /account/overview | insights | payments | saved | notifications | notifications/unread | security-summary`; `PATCH /account/profile`; `POST /account/onboarding | saved | notifications/read`; `DELETE /account/saved/:slug`
- **Catalogue:** `GET /categories`, `GET /services`, `GET /services/:slug`, `GET /services/:slug/reviews`, `GET /services/:slug/availability`, `GET /professionals`, `GET /professionals/:slug`, `GET /professionals/:slug/reviews|services`, `GET /plans`, `GET /stats`
- **Bookings (customer):** `POST /bookings`, `GET /bookings`, `GET /bookings/:id`, `POST /bookings/:id/pay | cancel | confirm | dispute | review`
- **Bookings (professional):** `GET /pro/bookings`, `POST /pro/bookings/:id/accept | start | deliver | decline | cancel`
- **Applications:** `POST /applications`, `GET /applications/me`, `PATCH /applications/:id`, `POST /applications/:id/submit`, `POST /applications/resume` (PDF parse)
- **Professional profile & gigs:** `GET|PATCH /pro/profile`, `PUT /pro/skills`, `POST /pro/portfolio`, `DELETE /pro/portfolio/:itemId`, `GET|POST /pro/services`, `GET|PATCH|DELETE /pro/services/:id`, `POST /pro/services/:id/publish|unpublish`
- **Workspace:** `GET|PUT /pro/availability`, `POST /pro/availability/exceptions`, `DELETE /pro/availability/exceptions/:id`, `GET /pro/analytics`, `GET /pro/reviews`, `GET /pro/earnings`, `POST /pro/payouts`, `GET /pro/plan`, `POST /pro/plan/checkout|verify`
- **Uploads:** `POST /uploads?kind=…`, `GET /uploads/rules`
- **Community (flag-gated):** `GET /community/config|connections|threads|threads/:id/messages`, `POST /community/connections`, `/connections/:id/action`, `/threads`, `/threads/:id/messages|read|block`
- **Admin:** `GET /admin/stats|analytics|applications|users|services|bookings|bookings/:id|payouts|subscriptions|notifications|audit`; `POST /admin/applications/:id/approve|reject`, `/admin/users/:id/{suspend|reactivate|reset-password}`, `/admin/services/:slug/{feature|unpublish|remove}`, `/admin/bookings/:id/resolve`, `/admin/payouts/:id/retry`, `/admin/notifications`
- **Payments:** `POST /api/v1/webhooks/paystack`; sandbox checkout `GET|POST /sandbox/checkout/:reference[/complete]`

---

## 14. Honest status notes

- Paystack is in **TEST mode**; Community (Messages / My network) is **switched off** in production.
- Verified live: health/readiness, sign-in, token renewal, onboarding & gig pages served, upload rules endpoint, storage enabled.
- Not yet verified by a real end-to-end run on production: public viewing of files uploaded to R2, LinkedIn PDF parsing on a real export, Google/GitHub sign-in, passkeys, a real Servix Pro purchase and a real payout.
