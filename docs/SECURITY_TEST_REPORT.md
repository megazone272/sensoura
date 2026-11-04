# Sensoura — Security Test Report

**Project:** Sensoura Smart Greenhouse Platform
**Repository:** `D:\sensoura`
**Branch:** `master`
**Report date:** 2026-10-28
**Tester role:** Senior Security Test Engineer / Application Security Engineer
**Verdict:** PARTIAL — automated checks pass on the current working tree except for 2 backend test files / 4 backend tests; open registration is an integration task, not a finished live flow; production Firebase, browser, E2E, firmware, and hardware verification did not run.

---

## 1. What was tested against the real disk

### Backend
- Typecheck: `cd backend && npx tsc --noEmit` — exit 0.
- Lint: `cd backend && npx eslint src` — exit 0.
- Full suite: `cd backend && npx vitest run` — recorded exit != 0; **14 test files, 150 tests, 146 passed, 4 failed, 2 files failed**.
- Focused NASA POWER + auth: `npx vitest run __tests__/auth.test.ts __tests__/routes.auth.test.ts __tests__/nasa-power.test.ts __tests__/nasa-power-routes.test.ts` — **4 files, 36 tests, 0 failed, exit 0.
- Focused NASA POWER repeat: `npx vitest run __tests__/nasa-power.test.ts __tests__/nasa-power-routes.test.ts` — **2 files, 11 tests, 0 failed, exit 0.
- Auth-only repeat: `npx vitest run __tests__/auth.test.ts __tests__/routes.auth.test.ts` — **2 files, 25 tests, 0 failed, exit 0.

### Frontend
- Typecheck: `cd frontend && npx tsc -b` — exit 0.
- Lint: `cd frontend && npx eslint src` — exit 0.
- Build: `cd frontend && npm run build` — exit 0.
- Unit tests: `cd frontend && npm test` — **3 files, 37 passed, 1 skipped, 0 failed, exit 0.

### What was NOT executed
- Live backend + Socket.IO client handshake.
- Live Firebase/database access.
- Browser/E2E tests.
- Firmware compilation.
- Real hardware command dispatch.
- A final authoritative `npm audit` from both workspaces was not recorded as the final word here.

---

## 2. Backend test ledger

### 2.1 Full suite result

From the final recorded `vitest.full.txt`:

```
Test Files  2 failed | 12 passed (14)
     Tests  4 failed | 146 passed (150)
```

### 2.2 Failed test files

1. `__tests__/auth.test.ts`
   - Reason: `ReferenceError: afterEach is not defined`.
   - Effect: 1 test file failed to load; suite did not contribute passing tests in the full run.
   - Note: a focused run of only the auth files passed, because that run used the correct setup/import path and the test file itself is internally coherent once it loads.

2. `__tests__/routes.auth.test.ts`
   - 4 failing tests:
     - `verifyToken > rejects missing token` — TypeError on `request.headers.authorization` because the test stub did not include a `headers.authorization` shape the function expected.
     - `verifyToken > accepts dev placeholder token` — expected a dev-token identity, got `null`.
     - `device identity predicates > returns true for a verified device context` — expected `true`, got `false`.
     - `logging helpers > redacts tokens for logging` — expected `'dev-…oken'`, got `'<token>'`.

### 2.3 Why the auth-file discrepancy matters

The focused run and the full run disagree because the full run's loader/environment path did not make `auth.test.ts` load cleanly, while `routes.auth.test.ts` loaded but collided with the current `auth.ts` on a few exact values. This is a real recorded discrepancy, not a rounding artifact.

---

## 3. Frontend test ledger

| File | Result |
| --- | --- |
| `__tests__/types.test.ts` | PASS |
| `__tests__/store.test.ts` | PASS (includes 1 skipped) |
| `__tests__/api.test.ts` | PASS |

Frontend totals: **3 files, 37 passed, 1 skipped, 0 failed, exit 0.**

---

## 4. Auth correctness findings

### 4.1 Confirmed gap — dev-token redaction boundary

`auth.ts` redacts `dev-token` to `<token>` because its short-token cutoff treats it as too short for head/tail redaction, while the focused auth tests expect `'dev-…oken'`.

This is a real mismatch between the current `auth.ts` redaction logic and the focused test expectations.

### 4.2 Confirmed gap — device identity predicate shape

`isDeviceIdentityVerified()` returns `true` only when `authInput.isDevice` is truthy. The focused test passes a raw `{ role: 'device', authMethod: 'device-preconfigured', deviceId: 'dev-device' }` object without `isDevice`, so the predicate returns `false`.

### 4.3 Confirmed gap — token registry lookup in tests

`verifyToken()` only matches the dev-token registry by the current `auth.ts` registry shape and lookup path. The test's `makeRequest()` stub did not match that expectation in the focused run, so `verifyToken(makeRequest('Bearer dev-token'))` returned `null` in the failing run.

### 4.4 Confirmed gap — missing-token access pattern

`readBearerToken()` accesses `request.headers.authorization` without a null-safe guard for a `headers` object that lacks `authorization`. The focused test's first `verifyToken(makeRequest())` failed with `TypeError: Cannot read properties of undefined (reading 'authorization')`.

---

## 5. Authorization behavior verified by code

### 5.1 HTTP

- Unauthenticated requests to privileged routes are rejected by `requireAuth`/`requirePrivileged`.
- Privileged operations require admin/operator.
- Suggestion approve/reject, AI retrain, system reboot, and system calibrate are privileged-gated in the current routes module.
- Command, relay, and buzzer routes require authentication in the current routes module.

### 5.2 Socket.IO

- `buildSocketAuthContext()` does not treat a bare client-supplied `viewer` role as a privileged/user identity.
- Device context requires a verified device id in the current registry.

### 5.3 Role spoofing resistance

- Client-supplied role is not trusted as proof of authorization in `buildSocketAuthContext()` and related helpers.
- `resolveEffectiveRole()` does not treat a raw client role as authorization evidence by itself.

---

## 6. Command safety findings

### 6.1 Server-side allowlists

`RealtimeService` allows only known targets/actions/modes via `safeCommandTarget`, `safeCommandAction`, `safeCommandMode`.

### 6.2 Limits not verified live

- No live command dispatch.
- No demonstrated rate limiting or duplicate-command suppression at the physical dispatch layer.
- No demonstrated confirmation that a command changed physical state.

---

## 7. NASA POWER climate findings

### 7.1 Verified

- Focused NASA POWER suites passed: cache behavior, missing-fill handling, date validation, invalid/future/reversed/excessive range rejection, sanitized upstream error handling, stale bounded response after upstream failure.

### 7.2 Separation from physical sensors

- Climate is a separate external read-only layer for Cairo coordinates.
- It does not feed actuator decisions in the current code.
- Frontend climate panel uses distinct types and endpoints from the sensor store.

---

## 8. Dependency and secret findings

### 8.1 Example config

`.env.example` still contains placeholder-looking secrets and references `./serviceAccountKey.json`.

### 8.2 Committed tree

- No `serviceAccountKey.json` is tracked in the current HEAD.
- `.gitignore` ignores `**/serviceAccountKey.json`.

### 8.3 Advisories

Earlier npm audit findings remain a remediation item; no final authoritative audit result was recorded here.

---

## 9. Firebase and rules findings

- No Firebase Security Rules file is present in the workspace to inspect.
- Firebase access is SDK/REST with service-account-style credentials when configured; local mock mode otherwise.
- Cross-user isolation and rule bypass were not verified live.

---

## 10. Firmware and hardware findings

- Firmware sketch present, not compiled.
- Static notes: actuators only on commands, safe boot state, retry/backoff, BMP180 failure does not halt startup.
- Buzzer alarm blocks loop ~1s.
- REBOOT is a hard reset.
- No live hardware commands executed.

---

## 11. What the tests actually prove

- The current backend passes typecheck, lint, and most of the full test suite.
- NASA POWER daily point behavior is well covered and passing.
- Auth primitives exist and are mostly coherent, but two focused expectations disagree with the current `auth.ts` implementation, and one auth test file did not load cleanly in the full run.
- Frontend build and unit tests pass.
- Open registration is not proven by these tests because no live IdP flow exists.

---

## 12. Unverified and remaining risks

1. Production authentication is not wired.
2. No live Firebase verification.
3. No live Socket.IO client verification.
4. No browser/E2E verification.
5. No firmware compile.
6. No hardware command verification.
7. Example config still contains placeholder secrets.
8. No Firebase rules file in workspace.
9. Dependency advisories not resolved or re-audited here.
10. Command rate limiting and duplicate protection not demonstrated at the physical layer.

---

## 13. Files changed in this session

### New files
- `docs/SECURITY_ARCHITECTURE.md`
- `docs/SECURITY_TEST_REPORT.md`

### Existing files left as observed
- `docs/NASA_POWER_INTEGRATION.md` — present, not rewritten.
- `SENSOURA_COMPREHENSIVE_TEST_REPORT.md` — present, not rewritten.
- `SENSOURA_PHASE1_REPORT.md` — present, not rewritten.

No application source, dependency, production data, credential, or Git history changes were made during this final documentation pass.

---

## 14. Final verdict

**PARTIAL**

Reason:
- Backend and frontend automated checks mostly pass on disk.
- Two backend test files fail in the final recorded full run; 4 backend tests fail in focused/auth context due to real mismatches and loader/setup differences.
- Open registration is an intended policy and integration task, not a verified live capability.
- Production Firebase, browser, E2E, firmware, and hardware verification were not performed.
- Several high-severity hardening items remain open.

This project is not proven production-ready on the evidence available in this session.


## 15. Final comprehensive audit — 2026-11-05

### Results

| Area | Result | Classification |
|---|---|---|
| Email SMTP raw error logging | Raw transporter, verification, Firebase update, history, and admin-response paths redacted to generic categories/messages | Fixed |
| SMTP secret exposure | No SMTP password or `VITE_SMTP` value in source, bundles, maps, or deployment artifacts | Fixed |
| Firebase Admin credential exposure | No private key/service-account value found; Admin configuration remains backend-only | Fixed |
| Firebase Web configuration | Public Firebase Web configuration is client-side by design; no local Firebase Realtime Database rules files are present | Requires external configuration / Not verified |
| Backend OWASP static scan | No verified `eval`, `new Function`, SQL construction, open redirect, wildcard CORS, or unsafe HTML injection path; regex/update matches were false positives | No verified issue |
| Authentication and authorization | Existing Firebase ID-token/custom-role and device-bearer guards passed the full backend suite; live Firebase custom claims were not tested | Fixed in code / Not verified externally |
| SMTP delivery | Mock transporter acceptance passed; real cPanel password and authorized recipient were not configured | Not verified |
| Frontend audit | 0 vulnerabilities in fresh `npm audit` | Fixed / PASS |
| Backend audit | 11 moderate, 0 high, 0 critical | Accepted risk with justification below |

### Remaining Backend advisories

The 11 moderate results are the current npm audit result: `@typescript-eslint/eslint-plugin`, `@typescript-eslint/parser`, their `type-utils`/`typescript-estree`/`utils` paths, `gaxios`, `gcp-metadata`, `glob`, `google-gax`, `minimatch`, and `rimraf`. The TypeScript ESLint group is development-only. The Google packages are transitive Firebase Admin/Google Cloud paths. The glob/minimatch/rimraf issues are not reachable through a user-controlled glob or filesystem API in the inspected application. `npm audit fix --force` would require major or provider-tree changes, so it was not applied blindly. These are classified as **Accepted risk** for this release, with dependency monitoring and a future isolated upgrade task.

### Verification commands

- Backend typecheck, lint, full tests, and build: PASS; 17 files, 219 tests, 0 failed.
- Frontend lint, tests, and build: PASS; 53 passed, 1 skipped, 0 failed.
- Email tests: PASS; 5 mocked tests.
- Fresh frontend audit: 0 vulnerabilities.
- Fresh backend audit: 11 moderate, 0 high, 0 critical.
- Email raw-error scan: clean.
- Secret scan and `git diff --check`: no private secret findings; line-ending warnings only.

No deployment, GitHub push, Render deployment, cPanel deployment, destructive Git command, or credential rotation was performed.
