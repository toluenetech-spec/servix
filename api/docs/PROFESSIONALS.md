# Servix — Professional Onboarding & Management (Phase C)

## 1. Application lifecycle

```
CUSTOMER ──create──▶ pending ──submit──▶ under_review ──review──▶ approved
                        │                                   │
                     (editable)                          rejected
                                                            │
                                              may create a NEW application
```

| State | Who sets it | Editable | Notes |
|---|---|---|---|
| `pending` | user (create) | ✅ owner only | Draft; save as often as needed |
| `under_review` | user (submit) | ❌ | Locked; awaiting review |
| `approved` | **server** (review) | ❌ | Triggers role promotion + profile creation |
| `rejected` | **server** (review) | ❌ | Reason stored; user may re-apply with a new application |

Constraints:
- One **active** application (pending / under_review / approved) per user.
- Users with `role=professional` or an existing profile cannot apply
  (`409 ALREADY_PROFESSIONAL`).
- Rejected applications are immutable; re-application creates a new row,
  preserving the full history.

## 2. Professional role transition (server-controlled)

`users.role` is **never** writable by any client request. The only code
path that sets `role='professional'` is the approval branch of
`POST /api/v1/applications/:id/review`, which runs in one transaction:

1. application → `approved`
2. user → `role='professional'`
3. `professional_profiles` row created (unique slug from the user's name,
   skills + portfolio copied from the application)

If any step fails, all roll back. Zod schemas strip unknown fields, so
payloads like `{role: "admin"}` on any endpoint are silently discarded
(covered by a role-escalation test).

**Review access:** the admin dashboard is Phase E scope. Until then the
review endpoint is internal only — hidden from OpenAPI and guarded by the
`X-Servix-Review-Key` header (`SERVIX_REVIEW_KEY` env; set a strong value
in production). It exists so the lifecycle is real and testable, not to
expose moderation publicly.

## 3. Authorization rules

| Actor | `/applications*` | `/pro/*` | Public catalogue |
|---|---|---|---|
| Anonymous | 401 | 401 | ✅ read |
| Customer | own applications only | 403 | ✅ read |
| Rejected applicant | own (immutable) + re-apply | 403 | ✅ read |
| Professional | 409 on create (already pro) | ✅ own resources only | ✅ read |

Mechanics:
- `requireAuth` — verifies the Bearer JWT.
- `requireProfessional` — **re-reads role + profile from the database** on
  every request; a stale or tampered token cannot grant pro access.
- All `/pro/*` queries are scoped to `req.professionalProfileId` derived
  server-side. Cross-professional access attempts return **404** (not 403)
  to prevent resource-ID enumeration.

## 4. Profile architecture

One `professional_profiles` row per professional, linked `1:1` to `users`
via nullable `user_id` (nullable because the seeded demo professionals
have no accounts). The same table serves:

- the public directory (`GET /professionals`, `GET /professionals/:slug`)
- the authenticated workspace (`GET/PATCH /pro/profile`)

Skills are replace-on-write (`PUT /pro/skills`), portfolio items are
CRUD (`POST/DELETE /pro/portfolio`), both owned via the profile id.
Aggregates (`startingPrice`) are recomputed on publish/unpublish.

## 5. Service ownership & lifecycle

```
draft ──publish──▶ active ──unpublish──▶ paused ──publish──▶ active
  │                                        │
  └───────────── archive (delete) ─────────┘        (archived = terminal)
```

- Services are created as `draft` — never publicly visible until
  published by their owner.
- Only `active` services appear in `GET /services*` (public).
- `archived` services disappear from both public and workspace lists.
- Route params accept the internal UUID **or** the public slug.
- Full server-side validation (zod): title ≥5 chars, price ≥ ₦1,000,
  short description 20–200 chars, description ≥50 chars, bounded lists
  for included/requirements/FAQs/gallery, category must exist.

## 6. Public vs. private endpoints

**Public (unchanged from Phase A):**
`GET /categories · /services · /services/:slug · /services/:slug/reviews ·
/professionals · /professionals/:slug (+reviews/services) · /testimonials ·
/plans · /faqs · /stats` — same shapes, filters, sorting, pagination.
Slugs remain the public IDs, so all existing frontend URLs keep working,
and approved professionals + published services appear alongside the
seeded demo catalogue automatically.

**Authenticated (Phase C):**

| Method | Path | Purpose |
|---|---|---|
| POST | `/applications` | Create draft application |
| GET | `/applications/me` | Own latest application |
| PATCH | `/applications/:id` | Update while pending |
| POST | `/applications/:id/submit` | pending → under_review |
| POST | `/applications/:id/review` | internal, key-guarded (see §2) |
| GET/PATCH | `/pro/profile` | Own profile |
| PUT | `/pro/skills` | Replace skills |
| POST/DELETE | `/pro/portfolio[/:id]` | Portfolio items |
| POST | `/pro/uploads` | Presigned-upload request (see §7) |
| GET/POST | `/pro/services` | List own / create draft |
| GET/PATCH/DELETE | `/pro/services/:id` | Read / update / archive own |
| POST | `/pro/services/:id/publish` · `/unpublish` | Visibility |

## 7. Storage architecture (R2/S3 boundary)

Binary files are never stored in PostgreSQL — only URL/key strings.

Contract (implemented): `POST /pro/uploads {kind, fileName, contentType,
size}` validates type (JPEG/PNG/WebP) and size (≤5 MB) server-side and
returns `{enabled, key, publicUrl, uploadUrl}`.

Current provider is an honest **LocalStubProvider**: it returns the key
contract with `enabled:false, uploadUrl:null` and an explanatory note —
it never fakes a successful upload. Activating real uploads is a
deploy-time swap in `src/lib/storage.ts` (`R2Provider` with S3 SigV4
presigning + `R2_*` env vars listed in the file header). No route or
frontend changes required.

## 8. Frontend

- `/professionals/apply` — application form + status states (draft /
  under review / approved / rejected with reason), honest sign-in and
  pre-launch guards. Route declared **before** `/professionals/:id`.
- `/pro` — professional workspace: Services tab (create/edit/publish/
  unpublish/remove with status badges and public-page links) and Profile
  tab (title, category, availability, city, about, skills) with a link to
  the live public profile.
- Built entirely from the existing design system (Field, Button, Tabs,
  Badge, cards, state blocks, toasts) — no new visual language, no
  Tailwind, no component libraries.
- Navbar shows a **Workspace** link for signed-in professionals.
