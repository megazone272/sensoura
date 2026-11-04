# SENSOURA — Deployment Readiness Report

**Date:** 2026-11-05
**Target paths:** cPanel Node.js application or Render service
**Deployment performed:** No.

## Readiness summary

SENSOURA is locally buildable and test-validated, but it is not yet cleared for an unverified public production launch. The application code is ready for a controlled deployment configuration pass; external credentials, Firebase Rules, domain/TLS, and a real SMTP acceptance test remain gates.

## Checklist

| Requirement | Status | Evidence or action |
|---|---|---|
| Backend typecheck | PASS | `npm run typecheck` succeeded. |
| Backend lint | PASS | `npm run lint` succeeded. |
| Backend tests | PASS | 17 files, 219 tests, 0 failed. |
| Backend server build | PASS | `npm run build:server` succeeded. |
| Frontend lint | PASS | `npm run lint` succeeded. |
| Frontend tests | PASS | 53 passed, 1 skipped, 0 failed. |
| Frontend production build | PASS | Vite production build succeeded; large-chunk warning remains non-blocking. |
| Node runtime baseline | PASS in code | Backend and production frontend builder require Node 22.12+. Configure the host explicitly. |
| Frontend/backend URL wiring | PASS in code | `VITE_API_URL`, `VITE_WS_URL`, and frontend origin are configurable. |
| Socket.IO production origin | NOT VERIFIED | Requires the deployed HTTPS frontend origin and live handshake test. |
| Firebase Admin credentials | NOT VERIFIED | Add service-account credentials only to backend runtime secrets. |
| Firebase Security Rules | NOT VERIFIED | No rules files were present; configure and review rules in Firebase. |
| Firebase custom claims | NOT VERIFIED | Create/verify admin/operator/viewer claims in the live project. |
| SMTP password | NOT CONFIGURED | Set `SMTP_PASS` only in cPanel/Render backend environment. |
| SMTP mocked templates/tests | PASS | 5/5 mocked email tests passed. |
| Real cPanel SMTP delivery | NOT VERIFIED | Run admin SMTP verify and send one authorized test email. |
| TLS/domain/DNS | REQUIRES EXTERNAL CONFIGURATION | Point the subdomain, configure HTTPS, and verify SPF/DKIM/DMARC from cPanel. |
| Device REST ingestion | NOT VERIFIED externally | Requires live ESP32 and production device bearer credential. |
| Physical relay/actuation | NOT VERIFIED | Requires hardware test and safety confirmation. |
| Persistent history | NOT VERIFIED | Configure Firebase/persistent storage before relying on history in production. |
| Dependency audit | ACCEPTED RISK | Frontend 0; backend 11 moderate, 0 high, 0 critical. |
| GitHub/Render/cPanel deployment | NOT PERFORMED | No push or deployment occurred. |

## cPanel path

Create the `info@sensoura.ox0x.com` mailbox, register the backend as a Node.js application using Node 22.12+, build with the repository’s cPanel helper, and set backend-only environment variables. Use `SMTP_HOST=mail.sensoura.ox0x.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER=info@sensoura.ox0x.com`, `SMTP_FROM_NAME=Sensoura`, and `SMTP_FROM_EMAIL=info@sensoura.ox0x.com`. Supply the real `SMTP_PASS` through cPanel Application Manager only. Keep it out of `public_html`, Git, and frontend variables.

After HTTPS and the production frontend origin are live, configure `FRONTEND_URL`, Firebase Authorized Domains, Firebase Rules, and custom claims. Then call the protected admin email verification endpoint and send one controlled test message. Real delivery must be confirmed by receipt in the authorized mailbox.

## Render path

Create separate frontend/backend services if the selected Render setup does not serve the compiled frontend from the backend. Set Node 22.12+ explicitly, configure encrypted environment variables, set production CORS/frontend origins, and keep Firebase Admin/SMTP credentials in backend secrets only. Verify Socket.IO over HTTPS/WSS and account for free-service sleeping behavior before connecting physical devices.

## Release gate

The release may proceed only after the following external gates pass: HTTPS domain, Firebase Rules, live custom claims, backend health/readiness, frontend login and email verification, Socket.IO live connection, authorized admin email verification, real cPanel SMTP test email, device telemetry ingestion, and a safe relay acknowledgement test.

Until those gates pass, the correct status is **code-ready for controlled deployment, not proven production-ready**.
