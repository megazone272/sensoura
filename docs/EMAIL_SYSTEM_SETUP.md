# SENSOURA transactional email setup

## Provider and runtime configuration

SENSOURA uses the confirmed cPanel SMTP server through Nodemailer with implicit TLS:

```env
SMTP_HOST=mail.sensoura.ox0x.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=info@sensoura.ox0x.com
SMTP_PASS=<set only in the backend runtime secret environment>
SMTP_FROM_NAME=Sensoura
SMTP_FROM_EMAIL=info@sensoura.ox0x.com
EMAIL_DEFAULT_LANGUAGE=en
```

Do not put `SMTP_PASS` in Git, frontend variables, `VITE_*` variables, browser code, or public_html. On cPanel, set the variables in Application Manager or the Passenger environment. On Render, set them as encrypted service environment variables. The SMTP password is intentionally not present in this repository.

The current service creates one reusable transporter, supports `verify()` for a safe connection check, uses text and HTML alternatives, rejects CRLF/header injection, escapes dynamic HTML values, validates recipients, rate-limits through the global Fastify limiter, and stores only bounded delivery metadata in memory. SMTP acceptance is not the same as final delivery or bounce confirmation.

## Firebase responsibility boundary

Firebase Authentication continues to own account creation, email verification action links, Google/GitHub sign-in, and password reset. Nodemailer is for application-generated transactional messages such as welcome, sensor-alert, AI-prediction, account-update, and contact-confirmation messages. This implementation does not replace Firebase verification or password reset tokens.

## Admin endpoints

All endpoints below require a Firebase ID token with the `admin` custom claim. Operators and viewers are rejected.

- `GET /api/admin/email/status` — non-secret configuration and bounded delivery summary.
- `GET /api/admin/email/verify` — invokes Nodemailer `verify()`; returns 503 when `SMTP_PASS` is absent or the connection fails.
- `GET /api/admin/email/preview?template=welcome&language=ar` — returns rendered HTML/text for review without sending.
- `POST /api/admin/email/test` — accepts `{ "recipient": "authorized@example.com", "template": "welcome", "language": "en" }` and sends a test email only after SMTP credentials are configured.

The dashboard Settings page displays email administration only for a UI-detected admin claim. The backend remains the source of authorization and always rechecks the claim.

## cPanel deployment

1. Create `info@sensoura.ox0x.com` in cPanel.
2. Confirm the outgoing server values in cPanel Email Accounts → Connect Devices.
3. Register the backend as a Node.js application in Application Manager/Passenger.
4. Use Node.js 22 or newer and the generated `backend/dist/index.js` startup entry. The cPanel build helper creates `backend/dist/public` with the frontend.
5. Add the SMTP variables in Application Manager; keep the password outside the application directory and outside `public_html`.
6. Configure the HTTPS subdomain reverse proxy/Passenger mapping and the production `FRONTEND_URL`.
7. Call `/api/admin/email/verify` with an admin session, then send one controlled test email.

SPF, DKIM, and DMARC values must be copied from the actual cPanel/DNS panel. Do not invent DNS records.

## Render notes

Render can use the package engine or an explicit `NODE_VERSION`. The repository requires Node `>=22.12.0`; set an explicit current Node 22/24 version or an upper-bounded compatible range in the Render service. Configure `SMTP_PASS` as an encrypted environment variable. Outbound SMTP access and port policy must be verified on the chosen Render service; no real delivery is claimed until the admin verification and controlled test email succeed.

## Testing

The test suite uses a mocked Nodemailer transporter and never sends a real customer email. It covers HTML escaping, Arabic RTL and English LTR rendering, preview generation, recipient/header-injection validation, mocked acceptance, and safe SMTP error mapping.
