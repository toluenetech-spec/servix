# Transactional email design

## Scope

`src/lib/emailTemplate.ts` supplies one email-safe, table-based layout (600px maximum width), Servix logo, forest-green/ivory palette, inline styles, mobile adjustments, preheader, CTA/fallback URL, detail tables, security notes and support footer. `src/lib/mailer.ts` uses it for every currently implemented transactional mail factory. Both HTML and plain text are passed to the existing delivery transport.

Covered: welcome/verification link; password reset link; registration/sign-in/reset OTP; booking/payment confirmations; cancellations with/without refunds; dispute opened/resolved with either outcome; professional payouts; enrollment, recovery-code usage, password reset and provider-link security notices; new-device sign-in alert (`newDeviceSignInMail`, added 2026-10-04 — see `docs/MFA.md` → *New-device sign-in alerts*). This does not introduce new notification events or change authentication flags, delivery providers, queues or database schema.

All dynamic HTML is escaped. Token query parameters are URL-encoded. URLs require HTTPS; HTTP loopback is permitted only outside production. OTPs must be six digits and appear in the body, not the subject/preheader. Plain-text OTPs include the same ten-minute expiry as HTML. Booking timestamps with an explicit timezone are formatted in Lagos time. Payout CTA uses the existing `/pro` route.

## Review locally (no delivery)

From `api/`:

```sh
npx tsx scripts/previewEmails.ts
```

From the repository root:

```sh
python3 -m http.server 4178 --bind 0.0.0.0 --directory .email-preview
```

Open the server's preview. Select any of 17 synthetic examples and toggle Desktop/Mobile. Plain-text links are available. No database, provider calls, real tokens or recipient addresses are used. Preview email links are disabled, and the existing logo is copied locally. Generated files are ignored by Git. The example inbox avatar is illustrative, not BIMI/sender-avatar configuration.

## Verification (2026-09-27)

- API typecheck and build: passed.
- Focused unit tests: 21 passed across email templates (9), email OTP crypto (7), security crypto (5).
- Chromium: all 17 email bodies loaded at mobile preview width, with working local logos and no horizontal overflow. Gallery tested at 360px. Desktop welcome and mobile OTP reviewed visually.
- Brevo HTML/plain-text payload contract tested with a mocked transport; no live email was sent.

These browser checks are not Gmail/Outlook/Apple Mail inbox certification. Actual client rendering and delivery must be checked after approval. Images may be blocked by mail clients; alt text/wordmark fallback remains. Rounded corners and other optional styling may vary in older Outlook.

Status: design approved by the user for deployment on 2026-09-27. Deployment is verified separately against the GitHub/Railway status for the release commit. Production authentication flags remain unchanged. No BIMI/DNS purchase or sender-avatar change is included.
