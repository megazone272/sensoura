# Sensoura — Phase 1: Build and Static Analysis

**Date:** 2026-10-24
**Environment:** Windows, Git Bash, Node.js v24.18.0
**Scope:** read-only discovery and configured checks only
**Decision this phase:** build/typecheck/lint PASS; production Firebase and firmware compile BLOCKED/NOT RUN

---

## 1. Repository discovery

**Working tree at start of Phase 1 (git status —read-only reference, not modified):**
- Branch: `master`
- Commit history (3 commits):
  1. `cad129a` — Initial commit: SENSOURA greenhouse monitoring platform
  2. `f1d9404` — Add AI data-integration, decision and prediction pipelines
  3. `fb74180` — Move /Sensoura/sensorData to the AirTemp/VOC/Barometricpressure contract
- Unstaged modified: `backend/__tests__/ai.test.ts`
- Untracked: `SENSOURA_COMPREHENSIVE_TEST_REPORT.md`, `package-lock.json`

**Repo layout:**
- Root: `D:\sensoura`
- Backend: `D:\sensoura\backend` (TypeScript, ESM, Fastify + Socket.IO + Firebase Admin + optional tfjs)
- Frontend: `D:\sensoura\frontend` (React 18 + Vite + Zustand + Socket.IO client + Recharts)
- Docs: `D:\sensoura\docs\ai-pipeline.md`
- Firmware: `D:\sensoura\firmware\src\main.ino` (ESP32-S3 style)

---

## 2. Package manifests and toolchain

### Backend `backend/package.json`
- Name: `sensoura-backend`, version `2.0.0`
- `"type": "module"`
- `"main": "dist/index.js"`
- Scripts:
  - `dev` → `tsx watch src/index.ts`
  - `build` → `tsc`
  - `start` → `node dist/index.js`
  - `test` → `vitest run`
  - `test:pipeline` → `vitest run __tests__/ai-pipeline`
  - `pipeline` → `tsx src/ai/pipeline/index.ts`
  - `pipeline:once` → `tsx src/ai/pipeline/index.ts --once`
  - `inspect:legacy` → `tsx scripts/inspect-legacy-predictions.ts`
  - `lint` → `eslint src`
  - `typecheck` → `tsc --noEmit`
  - `db:push` → `tsx scripts/push-schema.ts`
  - `ai:train` → `tsx src/ai/train.ts`
- Package manager: npm, lockfile present (`backend/package-lock.json`)
- Node constraint: `>=20.0.0`

### Frontend `frontend/package.json`
- Name: `sensoura-frontend`, version `2.0.0`
- `"type": "module"`
- `"private": true`
- Scripts:
  - `dev` → `vite`
  - `build` → `tsc -b && vite build`
  - `preview` → `vite preview`
  - `test` → `vitest run`
  - `lint` → `eslint src`
  - `typecheck` → `tsc -b`
- Package manager: npm, lockfile present (`frontend/package-lock.json`)
- Node constraint: `>=20`

### Firmware `firmware/src/main.ino`
- Arduino style, ESP32-S3 WiFi/MQTT telemetry sketch
- No compile toolchain available on this machine, so no firmware build was executed yet

### Toolchain confirmed
- Python 3.11 available (plus `python-dotenv`, optional)
- npm/node 24.18.0
- Backend and frontend use their own TypeScript 5.5.4 and separate lockfiles

---

## 3. Build and static checks — Phase 1 results

| Check | Command | Outcome |
| --- | --- | --- |
| Backend typecheck | `cd backend && npx tsc --noEmit` | PASS — no errors |
| Backend lint | `cd backend && npx eslint src` | PASS — no errors |
| Backend build | `cd backend && npx tsc` | PASS — dist emitted |
| Frontend typecheck | `cd frontend && npx tsc -b` | PASS — tsbuildinfo |
| Frontend lint | `cd frontend && npx eslint src` | PASS — no errors |
| Frontend build | `cd frontend && npm run build` | PASS — dist emitted, hydrate error was dev-only |
| Firmware compilation | PlatformIO/Arduino build | NOT RUN — no build toolchain available here |

**Build conclusion:** both backend and frontend typechecks, lint, and builds pass on the repository as it existed at Phase 1. Firmware compilation was not possible here and remains BLOCKED at this level; it is not a source-code failure, just an environment limitation.

---

## 4. Phase 1 static findings worth carrying forward

### 4.1 Security-relevant static items
- Backend authentication and authorization are present only as stubs/notes (for example the `/api/ai/retrain` comment and socket auth notes). Privileged API actions are not hard-denied today.
- `.env.example` ships placeholder secrets (`JWT_SECRET`, Firebase key, client email) and still references `FIREBASE_SERVICE_ACCOUNT_PATH`.
- The committed project does **not** include `serviceAccountKey.json` in the tracked tree, but the example config still points at it.
- `.gitignore` already excludes `**/serviceAccountKey.json`.

### 4.2 Dependency items
- `npm audit` from `backend/` in Phase 1 reported vulnerabilities, including eslint-related audit findings and direct/transitive npm advisories. These were recorded and are carried into the remediation plan rather than blindly force-upgraded.

### 4.3 Data model items worth carrying forward
- `lastUpdate` appears in seconds in firmware concepts but in milliseconds in seed/example values; the convention should be unified or explicitly documented.
- Barometricpressure is plural in the schema but singular in early UI labels; naming should be consistent.
- VOC unit semantics need a clear label in the frontend.

---

## 5. Phase 1 verification summary

**Phase 1 decision:** PASS for source/build/lint coverage; BLOCKED/NOT RUN for production Firebase configuration and firmware compilation, which depend on environment/tooling outside this machine.

**Carried into later phases:**
- Dependency remediation plan
- Auth/authorization hardening plan
- `.env.example` cleanup
- Timestamp and UI label/precision cleanup
- Blocked items: production Firebase validation, emulator validation, firmware compile

---

## Appendix — Verification notes from a later recheck (2026-10-28)

This appendix records what was rechecked on the current working tree, not what Phase 1 logically was. It is added for traceability after a recovery gate, not to overwrite Phase 1's original outcome.

### What was rechecked on 2026-10-28
- Backend typecheck: `cd backend && npx tsc --noEmit` — exit 0.
- Backend lint: `cd backend && npx eslint src` — exit 0.
- Full backend suite: `cd backend && npx vitest run` — 14 test files, 161 tests, 0 failed, exit 0.
- Focused NASA POWER + auth suites: `npx vitest run __tests__/auth.test.ts __tests__/routes.auth.test.ts __tests__/nasa-power.test.ts __tests__/nasa-power-routes.test.ts` — 4 files, 36 tests, 0 failed, exit 0.
- Focused NASA POWER repeat against final code: `npx vitest run __tests__/nasa-power.test.ts __tests__/nasa-power-routes.test.ts` — 2 files, 11 tests, 0 failed, exit 0.
- Frontend typecheck: `cd frontend && npx tsc -b` — exit 0.
- Frontend lint: `cd frontend && npx eslint src` — exit 0.
- Frontend build: `cd frontend && npm run build` — exit 0.
- Frontend tests: `cd frontend && npm test` — 3 files, 37 passed, 1 skipped, 0 failed, exit 0.

### Recovery-gate status on 2026-10-28
- `backend/src/routes/index.ts` is no longer a review marker. It is committed HEAD plus a coherent patch: auth imports and `requireAuth`/`requirePrivileged` applied to `/api/command`, `/api/ai-suggestions/:id/approve`, `/api/ai-suggestions/:id/reject`, `/api/relay`, `/api/buzzer`, `/api/ai/retrain`, `/api/system/reboot`, `/api/system/calibrate`; and `/api/history/sensor-data` changed from an open unbounded random generator to a dev-mock-gated, clearly labeled placeholder with a bounded count cap and an explicit miss note.
- `backend/src/services/auth.ts` is a new file. It exports `verifyToken`, `requireAuth`, `requirePrivileged`, `resolveEffectiveRole`, `canPerformPrivilegedAction`, `canManageSuggestions`, `isDeviceIdentityVerified`, `buildSocketAuthContext`, `resolveCaptured`, `redactBearerToken`, `getDevTokenRegistrations`, and related types.
- Trusted baseline modules still match committed HEAD/index exactly: `src/index.ts`, `src/services/firebase.ts`, `src/config/env.ts`, `src/socket/index.ts`, `scripts/push-schema.ts`.
- No source files were edited in this session except the new `auth.ts` write; the `routes/index.ts` write restored the committed module and then layered the already-present path. No unrelated user changes were reverted, and no destructive git operations were run.

### Remaining Phase 1 carryover items
- Dependency advisories remain until upgraded intentionally.
- `.env.example` placeholder secrets remain.
- No Firebase rules file is present to review.
- No live Firebase, browser, E2E, firmware compile, or hardware test ran in this session.

**Phase 1 recheck verdict:** the later recheck does not change Phase 1's original conclusion; it just confirms that the current working tree also passes automated checks and that the recovery-gate question about `routes/index.ts` is resolved in the current state.


## Appendix — Final security and email recheck (2026-11-05)

The final recheck added the cPanel SMTP service with backend-only password handling, bilingual HTML/text templates, admin-only status/verify/preview/test endpoints, safe HTML escaping, recipient validation, bounded delivery history, and generic SMTP error categories. Raw errors were removed from SMTP transporter verification, delivery failure logging, Firebase email-verification update logging, and admin test-email responses.

Evidence: Backend 219/219 tests passed; Frontend 53 passed with 1 skipped; both lint/typecheck/build pipelines passed; SMTP mocked suite 5/5 passed; frontend audit reports 0 vulnerabilities; backend audit reports 11 moderate, 0 high, 0 critical. The moderate findings remain accepted risk because they are development-only or transitive Firebase/Google dependency paths without an observed application reachability path, and forced upgrades would be major or provider-tree changes.

Real cPanel SMTP delivery remains **NOT VERIFIED**. It requires configuring the actual `SMTP_PASS` outside Git and successfully sending an authorized test message. Firebase Rules, live custom claims, hosting configuration, firmware, and hardware remain external/not verified items.
