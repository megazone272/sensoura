# SENSOURA — Security Remediation Report

**Date:** 2026-11-05
**Assessment type:** Final local security review after Backend, Frontend, Firebase-boundary, device, AI, and SMTP changes.

## Verdict

The review found no Critical or High npm advisories, no verified private-secret exposure, and no remaining raw SMTP/Firebase email error logging after remediation. The project is **hardened locally but not externally verified as production-secure** because Firebase Rules, live claims, real SMTP delivery, hosting/TLS, and hardware behavior require external checks.

## OWASP-oriented review

Authentication and authorization controls were reviewed across Firebase ID-token verification, role claims, privileged routes, device bearer routes, Socket.IO handshakes, metrics, and development-only tokens. The code distinguishes viewers, operators, administrators, and devices; privileged requests are guarded server-side. Live Firebase custom claims and production Firebase behavior were not tested, so those items are classified as **Requires external configuration / Not verified**.

Input validation was reviewed across API bodies, query parameters, command identifiers, relay/buzzer actions, AI suggestion identifiers, email recipients, and email templates. Strict Zod schemas and bounded limits are in place. The static scan found no verified `eval`, `new Function`, SQL string construction, open redirect, wildcard CORS, or unsafe HTML injection path. Regex matches related to JavaScript `.exec`, Firebase `update`, and textual documentation were false positives.

Error handling was reviewed for stack traces, provider responses, SMTP credentials, email bodies, authentication details, and server information. Production responses are generic. Email transport verification, send failures, Firebase verification updates, delivery history, and admin test-email responses now use safe categories/messages. A final email raw-error scan returned clean.

## Secret and credential review

Fresh scans of source, frontend bundles, source maps, backend output, Docker/deployment files, and tracked paths found no private key, service-account value, SMTP password, device-token value, or `VITE_SMTP` secret. `.env.example` matches are templates and contain no real secret values. Firebase Web configuration in the frontend is public client configuration by design; it is not a Firebase Admin credential.

Firebase Admin initialization remains backend-only. The actual service-account file and SMTP password must remain outside Git and outside public web directories.

## Dependency findings

Fresh frontend audit: **0 vulnerabilities**.

Fresh backend audit: **11 moderate, 0 high, 0 critical**. Findings include the TypeScript ESLint development toolchain, transitive `gaxios`, `gcp-metadata`, `google-gax`, `glob`, `minimatch`, and `rimraf` paths. The TypeScript ESLint advisories are development-only. The Google paths are transitive Firebase Admin/Google Cloud dependencies. The glob-family advisories have no observed user-controlled glob or filesystem traversal endpoint in this application.

Classification: **Accepted risk with justification**. `npm audit fix --force` would involve major/toolchain or provider dependency changes and could break compatibility. The release should continue monitoring these advisories and schedule an isolated dependency upgrade with a dedicated compatibility test. This report does not claim zero vulnerabilities.

## Firebase Rules and production configuration

No `database.rules.json`, `firestore.rules`, or `storage.rules` file was present in the inspected repository. Firebase Security Rules must be configured and reviewed in the Firebase project before public access. This is classified as **Requires external configuration / Not verified**, not as a fixed item.

Render/cPanel environment variables, TLS, domain routing, Node runtime selection, SMTP password, Firebase Admin credentials, and production CORS origins require external configuration. No deployment or external account mutation was performed.

## SMTP-specific controls

The SMTP implementation uses `mail.sensoura.ox0x.com`, port 465, implicit TLS, and the configured sender identity. `SMTP_PASS` is intentionally absent from the repository. Admin routes require the Firebase administrator role. The email renderer supports Arabic RTL and English LTR, text fallback, HTML escaping, safe dashboard origins, bounded history, and controlled test delivery.

Automated SMTP success means only that the mocked transporter accepted a message. **Real cPanel SMTP delivery is NOT VERIFIED.** Operational status may be changed only after an authorized test email succeeds with the actual cPanel credentials.

## Final classification

| Finding | Classification |
|---|---|
| Raw SMTP/provider errors in logs/responses | Fixed |
| Private credentials in source/bundles/artifacts | Fixed |
| Email recipient injection and unsafe HTML interpolation | Fixed |
| Backend/frontend validation regressions | Fixed; all final automated checks passed |
| Frontend npm advisories | Fixed; fresh audit is clean |
| Backend moderate advisories | Accepted risk with justification |
| Firebase Rules and live custom claims | Requires external configuration / Not verified |
| Real cPanel SMTP delivery | Not verified |
| Domain, TLS, Render/cPanel environment | Requires external configuration |
| ESP32 firmware/hardware actuation | Not verified |

No deployment, GitHub push, Render deployment, cPanel deployment, destructive Git operation, or credential rotation was performed.
