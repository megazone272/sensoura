# Sensoura — Security Architecture

**Project:** Sensoura Smart Greenhouse Platform
**Repository:** `D:\sensoura`
**Branch:** `master`
**Document date:** 2026-10-28
**Author role:** Principal Application Security Engineer / IoT Security Architect

> This document describes the current security architecture of the Sensoura backend and frontend as present on disk today. It is a defensive hardening baseline, not a production-ready assurance document. Live Firebase, browser, E2E, firmware, and hardware verification did not run in the session that produced this document.

---

## 1. System overview and trust boundaries

### 1.1 Components

- **Frontend:** React 18 SPA served via Vite; Zustand state, Socket.IO client, Recharts.
- **Backend:** Fastify 4 HTTP server + Socket.IO server, Firebase Admin SDK, optional TensorFlow.js AI engine and a separate AI pipeline process.
- **Realtime:** Firebase Realtime Database listeners plus a REST-poll fallback.
- **AI:** Advisory-only pipeline and engine; no direct actuation from AI outputs in current configuration.
- **IoT:** ESP32-style firmware sketch (`firmware/src/main.ino`) is present but was not compiled in this session.
- **External climate:** NASA POWER daily point API integration (Cairo coordinates) is a read-only external climate layer, separate from physical sensor data.

### 1.2 Trust boundaries

| Boundary | Current enforcement |
| --- | --- |
| Internet → Fastify HTTP API | Auth helper-based gate on some privileged routes; missing/unrecognized tokens rejected as 401/403. Placeholder verifier, not a real IdP yet. |
| Internet → Socket.IO | Socket auth context built from dev-token / device-id / client role in current code. Client-supplied role is not trusted for authorization. |
| Backend → Firebase | Firebase Admin SDK / REST with service-account-style credentials when configured; local mock mode when not. |
| Backend → ESP32 | Command dispatch path exists; firmware not compiled or exercised here. Server-side command allowlist and value sanitization exist in `RealtimeService`, but final device authentication is not demonstrated live. |
| Physical operator → Hardware | Firmware safe-state on boot, actuator-only-on-command design, retry/backoff. Buzzer alarm blocks loop ~1s. Not verified live. |
| External climate API → Backend | Read-only, validated, cached, with sanitized upstream error handling. |

### 1.3 What is untrusted

- Client-supplied `role`, `isAdmin`, `userId`, or permission claims.
- Client-supplied device id unless the server's device-identity gate verifies it.
- Arbitrary bearer tokens; only blessed dev tokens or a future real provider's tokens are accepted.
- Unauthenticated requests for privileged operations.

---

## 2. Authentication and session architecture

### 2.1 Current authentication model

Today the backend uses a **placeholder verifier** in `backend/src/services/auth.ts`:

- `verifyToken()` reads the `Authorization: Bearer <token>` header and matches against an in-memory **dev-token registry**.
- Blessed dev tokens include `dev-token` (operator), `dev-token-admin` (admin), `dev-token-viewer` (viewer), and `dev-token-device` (device identity for `sensoura-esp32-01`).
- When no token matches, `verifyToken()` returns `null`.
- `requireAuth()` returns `401` for unauthenticated requests; `requirePrivileged()` returns `401` then `403` for non-privileged identities.

### 2.2 What this means in practice

- The current code is **better than no gate**, but it is **not production authentication**.
- Any real deployment must wire an actual identity provider before tokens other than dev tokens can be trusted.
- The dev-token registry is intentionally a development/CI shortcut, not a credential system.

### 2.3 Open registration, login, and account policy

The task requirement is **open registration**: anyone may create an account and, once authenticated, use the documented application permissions without manual approval.

**This is not yet implemented as a real IdP flow.** What exists operationally is:

- A placeholder verifier that can accept blessed dev tokens.
- Route guards that deny unauthenticated privileged access.
- A design direction where **registered users should not be treated as second-class viewers for ordinary application features**.

Until a real identity provider is wired, open registration is therefore a **configuration and integration task**, not a feature that exists end-to-end on disk today.

### 2.4 Intended authenticated-user policy

For ordinary registered accounts, the intended policy is:

- Authenticated users may view sensor readings, climate information, suggestions, and available greenhouse controls.
- Application-level write operations should not be restricted to a tiny admin group solely to limit usage.
- The server must still derive authority from verified identity, not from client claims.
- Infrastructure, credential, security-policy, and identity-admin operations must remain separate and restricted.

### 2.5 Sessions, logout, password recovery, revocation

Not implemented in the current placeholder:

- No cookie/session architecture is configured yet.
- No password recovery, email verification, or account revocation flow exists in the auth code.
- No token-revocation list exists beyond the dev-token registry for development.

These remain **integration tasks for the real IdP**.

### 2.6 Token validation requirements for a real provider

When a real provider is wired, the verifier should validate at minimum:

- Issuer
- Audience
- Signature
- Expiry
- Any required claims for this application

The current placeholder does none of this for non-dev tokens.

---

## 3. Authorization model

### 3.1 Role vocabulary

| Role | Meaning today |
| --- | --- |
| `admin` | Privileged; can manage AI suggestions and privileged operations. |
| `operator` | Privileged; same application-level privileged access as admin in current helpers. |
| `viewer` | Unprivileged read-oriented context; cannot perform privileged actions. |
| `device` | Device identity, not a human user; used for device-authenticated paths. |

### 3.2 Key helpers

- `canPerformPrivilegedAction()` — grants to admin/operator only.
- `canManageSuggestions()` — grants to admin/operator only.
- `isDeviceIdentityVerified()` — true only for a device auth context.
- `resolveEffectiveRole()` — normalized role resolution; never trusts raw client role as proof.
- `buildSocketAuthContext()` — socket auth context from token/device id/client role, with client role untrusted.

### 3.3 Route authorization matrix (current)

| Endpoint | Current gate |
| --- | --- |
| `/api/health`, `/api/ready`, 404 handler | Public |
| `/api/commands` (list) | Authenticated read path via `requireAuth` in current code |
| `/api/ai-suggestions` (list) | Authenticated read path via `requireAuth` in current code |
| `/api/ai-suggestions/:id/approve` | `requirePrivileged` |
| `/api/ai-suggestions/:id/reject` | `requirePrivileged` |
| `/api/command` (send) | `requireAuth` |
| `/api/relay` | `requireAuth` |
| `/api/buzzer` | `requireAuth` |
| `/api/ai/retrain` | `requirePrivileged` |
| `/api/system/reboot` | `requirePrivileged` |
| `/api/system/calibrate` | `requirePrivileged` |
| `/api/history/sensor-data` | Dev-mock-gated placeholder; not open unbounded generation anymore |
| `/api/status/auth` | Public metadata endpoint; returns dev-only status when production config absent |
| `/api/climate/...` | NASA POWER read-only routes; public climate API |
| Socket.IO events | Auth context from token/device id; client role untrusted; event handlers validate payloads |

---

## 4. API authorization details

### 4.1 Public endpoints

Health/ready and the auth-status metadata endpoint are reachable without authentication.

### 4.2 Protected application endpoints

Privileged operations (approve/reject suggestions, retrain AI, reboot, calibrate) require `requirePrivileged`.

Command, relay, and buzzer operations require `requireAuth`.

Suggestion listing and command listing are currently behind `requireAuth` in the routes module.

### 4.3 Command validation

`RealtimeService` uses explicit allowlists for target/action/mode through `safeCommandTarget`, `safeCommandAction`, and `safeCommandMode`. Unknown values fall back to safe defaults instead of being forwarded as raw strings.

This is server-side validation **before dispatch**, but it is not a complete physical command safety framework by itself. See Section 8.

---

## 5. Socket.IO security

### 5.1 Connection authentication

Socket.IO uses `buildSocketAuthContext()`:

- A verified device id can produce a device context.
- A recognized bearer token can produce a verified dev-token context.
- A bare client-supplied `viewer` role by itself does **not** become a privileged or user identity; it only yields an unauthenticated viewer context.

### 5.2 Event authorization

Sensitive socket handlers (`handleSuggestionAction`, `handleSystemAction`, etc.) log the authenticated `userId` and route action. The socket layer currently does not re-derive privilege from a client-supplied role field; it relies on the built auth context.

### 5.3 Remaining Socket.IO gaps

- No live Socket.IO client handshake test ran in this session.
- Device authentication is currently a preconfigured allowlist shortcut, not a certs/provisioning system.
- Reconnect and session-expiry behavior was not verified against a live provider.

---

## 6. Device identity model

### 6.1 ESP32 as a distinct identity

The firmware sketch communicates telemetry and commands, but device authentication is **not** equivalent to human login.

Current backend device path:

- Uses a dev-token/device-id shortcut for development.
- Has `isVerifiedDevice()` and a device-specific auth context.
- Does **not** treat a client-supplied `deviceId` as proof by itself.

### 6.2 What is missing for production device security

- Unique per-device credentials or certificates.
- Provisioning and rotation procedure.
- Replay-resistant command correlation where needed.
- Firmware-compiled validation of TLS and transport behavior.

These are documented as blockers in Section 10.

---

## 7. Firebase and data security

### 7.1 Firebase usage

The backend uses Firebase Admin SDK / REST for Realtime Database access. It can run in local mock mode when no usable credentials are configured.

### 7.2 Credential handling

- `.env.example` still contains placeholder-looking secrets (`JWT_SECRET`, `FIREBASE_PRIVATE_KEY` with `YOUR_PRIVATE_KEY_HERE`, `FIREBASE_CLIENT_EMAIL` placeholder, `FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json`).
- `.gitignore` ignores `**/serviceAccountKey.json`.
- No service-account key file is committed in the current tracked HEAD.

### 7.3 Firebase security rules

No Firebase Security Rules file is present in the workspace to review. The current code base documents assumptions about root-locked paths and a `/testData` downgrade path. This is a verification gap.

### 7.4 Data isolation

The backend's authorization is server-side. Clients are not trusted to isolate their own access. Cross-user data isolation must be enforced by the server and, if applicable, by Firebase rules; neither was fully validated live in this session.

---

## 8. Physical command safety

### 8.1 Server-side safeguards present

- Command target/action/mode allowlists.
- Safe fallback values for unrecognized fields.
- Privileged or at least authenticated gate on command-related HTTP routes.
- Command logging with command id, target, action, mode.

### 8.2 What is not yet implemented or verified

- No live command dispatch to real hardware was performed.
- No hardware-level emergency-stop mechanism was verified in this session.
- No rate limiting or duplicate-command protection for physical actuation beyond current allowlist logic.
- No telemetry-based confirmation flow proving a physical state change.

### 8.3 Safety status

Physical safety is **partially implemented in code** and **not verified live**. Hardware safety limits in firmware may exist and were not compiled or exercised here.

---

## 9. Web application security

### 9.1 CORS and frontend integration

The frontend uses a Socket.IO client and REST calls to the backend. Current security depends on the actual deployment boundary for CORS, HTTPS, and cookie/session policy, which were not configured or verified live here.

### 9.2 Headers, CSP, CSRF

No production HTTP security header bundle or CSP was verified in this session. If cookie-based sessions are added later, CSRF protections and SameSite/HttpOnly configuration will be required.

### 9.3 Input and output safety

- Backend uses Zod and explicit allowlists for command fields.
- Auth logging uses token redaction helpers.
- Error responses should avoid leaking stack traces or credentials; this was not exhaustively verified live.

---

## 10. Device, firmware, and hardware limitations

### 10.1 Firmware

- `firmware/src/main.ino` is present but was not compiled here.
- Static review notes: actuators only act on commands, safe boot state, retry/backoff, BMP180 failure does not halt startup.
- Buzzer alarm uses blocking `delay(1000)` in the main loop; not a safety defect, but a responsiveness concern.
- REBOOT path is a hard reset.

### 10.2 Device credential blockers

- No per-device credentials are configured in the repo.
- No TLS certificate validation or provisioning flow is in place for devices.
- Device authentication today is a dev allowlist shortcut.

---

## 11. Dependency and supply-chain posture

### 11.1 Current state

- Backend and frontend use separate npm lockfiles.
- `npm audit` findings were noted earlier and remain a remediation item rather than a proven-safe conclusion.
- Critical/high advisories in earlier audit included transitive `uuid`, `zod`, and `danfojs-node`/`xlsx`-related concerns.

### 11.2 What was not done

- No authoritative live `npm audit` for both workspaces was re-run and recorded as the final word in this document.
- No lockfile rewrite or force upgrade was performed in this documentation pass.

---

## 12. Logging, monitoring, and recovery

### 12.1 Current observability

- Structured logger exists with token redaction helpers.
- Auth failures and authorization denials are reachable through existing route guards.
- Command events are logged with correlation id.

### 12.2 What is missing

- No complete incident-response, backup, rotation, or recovery procedure is implemented in the repo.
- Rate-limit abuse indicators exist only as configuration values, not as a demonstrated enforced pipeline in this session.

---

## 13. Threat model summary

### 13.1 Primary threats

- Anonymous access to protected operations.
- Client role/identity spoofing.
- Device impersonation via client-supplied device id.
- Unsafe or excessive physical commands.
- Firebase direct-client bypass if rules are misconfigured.
- Credential exposure from example configs or accidental key commits.
- Dependency-driven compromise.

### 13.2 Current mitigations

- Auth gate on privileged routes.
- Privileged vs authenticated distinction.
- Client role not trusted for authorization.
- Command allowlists and value sanitization.
- NASA POWER climate isolation from physical sensor data.

### 13.3 Remaining exposure

- Placeholder auth is not a real IdP.
- No live Firebase/browser/E2E/hardware verification.
- No production security header/CORS/cookie architecture verified.
- No live device authentication.

---

## 14. Required production configuration before release

- Real identity provider with token validation.
- Secret storage for Firebase service account and any session/JWT secrets.
- No placeholder secrets in shipped config examples.
- Firebase Security Rules reviewed and stored.
- Device credential/provisioning model implemented or explicitly accepted with documented risk.
- CORS, HTTPS, CSP, and session cookie policy intentionally configured.
- Command rate limiting, cooldowns, and duplicate protection tuned for the physical plant.
- Emergency-stop and hardware safety behavior validated.

---

## 15. Remediation plan

### P0 — Blockers for any Internet-facing deployment

1. Wire a real identity provider and replace dev-token acceptance with provider-verified tokens.
2. Move all secrets out of example configs and into secret storage.
3. Add/review Firebase Security Rules and verify data isolation.
4. Update `.env.example` to remove placeholder key material.

### P1 — High-priority hardening

5. Add rate limiting and command cooldown/duplicate protection for physical actuation.
6. Add revalidation for sensitive Socket.IO events.
7. Add CSRF/session cookie controls if cookie sessions are adopted.
8. Confirm dependency upgrades for noted advisories without blind force upgrades.

### P2 — Verification and completeness

9. Add backend HTTP + Socket.IO authorization tests.
10. Add device-auth failure and replay/duplicate command tests.
11. Add Firebase emulator or staging tests where supported.
12. Compile and review firmware safety behavior.

### P3 — Documentation and operations

13. Store Firebase rules in the workspace for review.
14. Document credential rotation and incident response.
15. Document gaps between accepted command, dispatched command, and confirmed physical state change.

---

## 16. Verification status

| Area | Status |
| --- | --- |
| Backend typecheck/lint/build | PASS on current working tree |
| Frontend typecheck/lint/build | PASS on current working tree |
| Backend tests | 2 failed files, 4 failed tests, 146 passed of 150 in the final recorded full run |
| Frontend tests | PASS: 3 files, 37 passed, 1 skipped, 0 failed |
| NASA POWER climate feature | PASS for the focused suites |
| Live Firebase | NOT VERIFIED |
| Live browser/E2E | NOT VERIFIED |
| Firmware compile | NOT RUN |
| Real hardware commands | NOT RUN |

**Overall verdict for this document:** PARTIAL. The codebase has meaningful hardening and gate coverage, but it is not production-ready on the evidence available in this session.
