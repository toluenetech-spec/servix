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
| `approved` | **server** (admin review) | ❌ | Triggers role promotion + profile creation |
| `rejected` | **server** (admin review) | ❌ | Reason stored; user may re-apply |

Constraints: one active application per user; professionals cannot
re-apply (`409 ALREADY_PROFESSIONAL`); rejected applications are
immutable (re-application creates a new row, preserving history).

## 2. Professional role transition (server-controlled)

`users.role` is **never** writable by any client request. The only code
path that sets `role='professional'` is the approval branch of
`POST /api/v1/admin/applications/:id/approve` (Phase E — authenticated
admin, DB-verified role, audit-logged), which runs in one transaction:

1. application → `approved`
2. user → `role='professional'`
3. `professional_profiles` row created (unique slug, skills + portfolio
   copied from the application)
4. audit_log row written (actor admin, action `application.approve`)

If any step fails, all roll back. Zod schemas strip unknown fields, so
payloads like `{role: "admin"}` are silently discarded (covered by a
role-escalation test).

> **Phase E change:** the temporary `X-Servix-Review-Key`-guarded
> `POST /applications/:id/review` bridge has been REMOVED. Application
> review now happens exclusively through the authenticated admin
> endpoints and the `/admin` console UI.

## 3. Authorization rules

| Actor | `/applications*` | `/pro/*` | `/admin/*` | Public catalogue |
|---|---|---|---|---|
| Anonymous | 401 | 401 | 401 | ✅ read |
| Customer | own applications only | 403 | 403 | ✅ read |
| Rejected applicant | own (immutable) + re-apply | 403 | 403 | ✅ read |
| Professional | 409 on create (already pro) | ✅ own resources only | 403 | ✅ read |
| Admin | — | — | ✅ (DB-verified role) | ✅ read |

Mechanics:
- `requireAuth` — verifies the Bearer JWT.
- `requireProfessional` — **re-reads role + profile from the database** on
  every request; a stale or tampered token cannot grant pro access.
- `requireAdmin` (Phase E) — same DB re-read for the admin role; a forged
  JWT `role:admin` claim is rejected, suspended admins lose access
  immediately.
- All `/pro/*` queries are scoped to `req.professionalProfileId`.
  Cross-professional access attempts return **404** (anti-enumeration).

## 4. Profile architecture

One `professional_profiles` row per professional, linked `1:1` to
`users` via nullable `user_id` (demo pros have no accounts). The same
table serves the public directory and the authenticated workspace.
Skills are replace-on-write; portfolio items are CRUD; `startingPrice`
is recomputed on publish/unpublish.

## 5. Service ownership & lifecycle

```
draft ──publish──▶ active ──unpublish──▶ paused ──publish──▶ active
  │                                        │
  └───────────── archive (delete) ─────────┘        (archived = terminal)
```

- Services are created as `draft` — never publicly visible until
  published by their owner.
- Only `active` services appear in `GET /services*` (public).
- Route params accept the internal UUID **or** the public slug.
- Full server-side zod validation (title/price/description lengths,
  category existence, bounded lists).
- **Phase E:** admins can additionally `pause`/`unpause` any service for
  moderation (CAS transitions, audit-logged).

## 6. Public vs. private endpoints

**Public (unchanged from Phase A):** categories, services (+detail,
reviews, availability), professionals (+detail, reviews, services),
testimonials, plans, faqs, stats, contact — same shapes, filters,
sorting, pagination. Slugs remain the public IDs.

**Authenticated (Phase C, updated in Phase E):**

| Method | Path | Purpose |
|---|---|---|
| POST | `/applications` | Create draft application |
| GET | `/applications/me` | Own latest application |
| PATCH | `/applications/:id` | Update while pending |
| POST | `/applications/:id/submit` | pending → under_review |
| POST | `/admin/applications/:id/approve` / `/reject` | Admin review (Phase E) |
| GET/PATCH | `/pro/profile` | Own profile |
| PUT | `/pro/skills` | Replace skills |
| POST/DELETE | `/pro/portfolio[/:id]` | Portfolio items |
| POST | `/pro/uploads` | Presigned-upload request (see §7) |
| GET/POST | `/pro/services` | List own / create draft |
| GET/PATCH/DELETE | `/pro/services/:id` | Read / update / archive own |
| POST | `/pro/services/:id/publish` · `/unpublish` | Visibility |

## 7. Storage architecture (R2/S3 boundary)

Binary files are never stored in PostgreSQL — only URL/key strings.

Contract: `POST /pro/uploads {kind, fileName, contentType, size}`
validates type (JPEG/PNG/WebP) and size (≤5 MB) server-side and returns
`{enabled, key, publicUrl, uploadUrl}`.

**Phase E:** the real `R2Provider` is implemented — S3-compatible SigV4
presigned PUT/DELETE URLs (signer verified against the official AWS
documentation test vector), UUID keys with extensions derived from
content type only, and a daily orphan sweep (presigned >24h, never
referenced by profile/portfolio/service media). It activates when
`STORAGE_PROVIDER=r2` + `R2_*` env vars are configured. Without
credentials the honest **LocalStubProvider** still returns
`enabled:false, uploadUrl:null` — it never fakes a successful upload.
Every presign is recorded in the audit log for orphan tracking. Storage
secrets never reach the browser; clients upload directly to R2 with the
short-lived presigned URL.

## 8. Frontend

- `/professionals/apply` — application form + status states.
- `/pro` — professional workspace: Bookings, Services, Earnings, Profile.
- `/admin` (Phase E) — admin console for application review, moderation,
  user management, dispute resolution, payout monitoring and the audit
  log.
- Built entirely from the existing design system (Field, Button, Tabs,
  Badge, cards, state blocks, toasts) — no new visual language, no
  Tailwind, no component libraries.
- Navbar shows **Workspace** for professionals and **Admin** for admins.
