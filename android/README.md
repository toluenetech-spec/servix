# Servix Android

Native Android client for Servix (https://www.servix.name.ng), built in Google AI Studio (Build → Android) from this repository.

- `AGENTS.md` — instructions for the coding agent (start here)
- `SPEC.md` — screens, API contract, brand, rules
- `app/` — the Android project (Kotlin, Jetpack Compose, Material 3)
- `reference/` — read-only copy of the Servix web frontend source + API docs/routes, so the app is a faithful reconstruction of the real product (not shipped in the APK)

Backend: the production Servix API (`https://api.servix.name.ng/api/v1`, OpenAPI at `/api/v1/docs/json`). No secrets are required or stored.
