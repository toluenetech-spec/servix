# Servix Android — Stitch Design Brief

**Purpose.** This folder is the complete, evidence-based description of the Servix Android
application as it exists today, prepared so that Google Stitch (or any designer) can redesign the
app screen by screen **without changing what the app does**.

**What was investigated.** The GitHub repository `toluenetech-spec/servix-android`, branch `main`,
commit `61a1c83` (versionCode 100, versionName 1.0.0 — the build currently on Google Play internal
testing). Pull request #4 (`arena/58792043-servix-android`, head `3e48a0e`) was also read because it
carries work in flight; everything from it is marked **🟡 In flight (PR #4, not on main)**.
The web platform (`toluenetech-spec/servix`) was consulted only to state which platform features the
Android app does **not** expose.

**How the evidence was gathered.** Static reading of every Kotlin source file, resource file, Gradle
file and markdown document in the Android repository (the `.agents/skills` and `agent/skills`
folders are third-party skill text and were skipped). No emulator or device was available, so no
new screenshots were taken. All screenshots in `screenshots/` are the repository's own CI-rendered
images (see `screenshots/SCREENSHOT_INDEX.md` for provenance).

## Status legend (used in every file)

| Mark | Meaning |
| --- | --- |
| ✅ Implemented | Code exists on `main`, is reachable from the UI, and calls a real backend route |
| 🟠 Partial | Code exists but is unreachable, read-only, or only half of the journey is in the app |
| 🟡 In flight | Exists only on PR #4 (not merged, not released) |
| ⚪ Platform-only | Exists on the Servix website/API but **not** in the Android app |
| ⛔ Not implemented | Mentioned in docs/plans only; no app code |

Nothing marked 🟠, 🟡, ⚪ or ⛔ may be described to Stitch as a working feature.

## Files

| File | What it contains |
| --- | --- |
| `DESIGN.md` | **Master document** — the single file to hand to Stitch; links to everything below |
| `SERVIX_PRODUCT_OVERVIEW.md` | What Servix is, who uses the app, core value proposition, business rules |
| `APPLICATION_ARCHITECTURE.md` | Layers, modules, data flow, state handling — with Mermaid diagrams |
| `SCREEN_INVENTORY.md` | Every screen, sheet and dialog: route, source file, status, screenshot |
| `SCREEN_SPECIFICATIONS.md` | Per-screen specification: purpose, elements, data, actions, states |
| `USER_ROLES_AND_PERMISSIONS.md` | Guest / customer / professional / admin — what each sees in the app |
| `USER_JOURNEYS.md` | End-to-end flows (onboarding, booking, payment, review, AI, account) with Mermaid |
| `FEATURE_CATALOG.md` | Every feature with status, source reference and screenshot |
| `DASHBOARDS_AND_ANALYTICS.md` | Home dashboard, plan/usage, insights data — what is shown vs. only fetched |
| `NAVIGATION_MAP.md` | Bottom bar, stack, deep links, back behaviour — with Mermaid |
| `DESIGN_SYSTEM_AUDIT.md` | Colours, type, radii, motion, components, copy; inconsistencies found |
| `API_AND_DATA_REFERENCE.md` | Backend endpoints the app calls, data models, feature flags |
| `STITCH_DESIGN_REQUIREMENTS.md` | Constraints and prompts for the redesign (what must stay, what may change) |
| `IMPLEMENTATION_TRACEABILITY.md` | Screen ↔ source file ↔ endpoint ↔ test ↔ screenshot matrix |
| `screenshots/` + `screenshots/SCREENSHOT_INDEX.md` | 44 PNGs in three separate folders — `app-renders/` (current app on `main`, CI renders, **fixture data**), `play-listing/` (Play Store promotional images, fixture data), `in-flight-pr4/` (unshipped PR #4 prototypes) — each listed with provenance |
| `INVESTIGATION_REPORT.md` | What was examined, how, gaps, and a summary of findings |

## Rules this package follows

- Documents what exists; no redesign is proposed here (requirements for Stitch are in
  `STITCH_DESIGN_REQUIREMENTS.md` and are explicitly labelled as constraints, not proposals).
- Every claim cites a source path (`app/src/main/java/ng/name/servix/app/...` abbreviated as
  `ui/...`, `data/...` etc.) and, where useful, a line number at commit `61a1c83`.
- No secrets, tokens, keystores or credentials appear anywhere in this folder.
- No application code or configuration was modified.
