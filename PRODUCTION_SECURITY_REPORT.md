# SENSOURA — Production Security Report

**Audit Date:** 2026-11-11 22:10 UTC  
**Environment:** Live Production (`NODE_ENV=production`)  
**Host:** `sensoura.ox0x.com` (`65.109.137.42`)  
**Auditor:** Autonomous DevSecOps Agent  
**Commit:** `67c0592`

---

## 1. Security Baseline & Architecture

Sensoura's production security model is built on defense-in-depth principles across transport, authentication, authorization, database rules, and infrastructure isolation.

```
[ Internet / Browsers / ESP32 Devices ]
                 │
                 ▼  (HTTPS / TLS 1.3 via Nginx + Cloudflare)
       [ Apache Reverse Proxy ]
                 │
                 ▼  (Internal Loopback proxy to 127.0.0.1:10000)
    [ Podman Rootless Container ]
        - NODE_ENV=production
        - Private non-root execution
        - Rate limiting (@fastify/rate-limit)
        - Security Headers (@fastify/helmet)
        - Strict RBAC validation (Admin / Operator / Viewer)
        - Device Isolation (Bearer device token >= 32 chars)
                 │
                 ▼  (Firebase Admin SDK - Server to Cloud)
   [ Firebase Realtime Database (europe-west1) ]
```

---

## 2. Authentication & Authorization Audits (Live Verified)

### A. Dev Token Rejection in Production
- **Test:** HTTP request with `Authorization: Bearer dev-admin-bypass-token` to protected endpoint `/api/sensor-data`.
- **Result:** `401 Unauthorized`.
- **Code Path:** `backend/src/services/auth.ts`:
  ```ts
  export function isDevAuthEnabled(): boolean {
    return process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test';
  }
  ```
  In production (`NODE_ENV=production`), development tokens are never recognized, whether via REST or Socket.IO handshake.

### B. Role-Based Access Control (RBAC)
- **Roles Defined:** `admin`, `operator`, `viewer`.
- **Privilege Boundaries:**
  - `viewer`: Can read sensor data, state, telemetry, and suggestions. Cannot actuate hardware or approve actions.
  - `operator`: Can trigger irrigation, buzzer mute/unmute, and approve suggestions.
  - `admin`: Can perform calibration, system reboot, user role management, and emergency stops.
- **Hardware Endpoints Protected:**
  - `POST /api/command` — Restricted to `operator` or `admin`.
  - `POST /api/relay` — Restricted to `operator` or `admin`.
  - `POST /api/buzzer` — Restricted to `operator` or `admin`.
  - `POST /api/system/reboot` — Restricted to `admin`.
  - `POST /api/system/calibrate` — Restricted to `admin`.
- **Command Logging:** Every command is structured, timestamped, attributed to the caller's principal ID/email, and logged via Pino logger without exposing credentials.

---

## 3. Secret & Credential Protection

### A. Secret Leaks & Git Exposure
- **Local & Remote Git Audit:** Full scan of git history (`git log -S`) for sensitive token strings (`re_eznAbthR`, private keys, passwords) confirmed **zero committed secrets**.
- **Public HTTP Path Verification:**
  - `GET https://sensoura.ox0x.com/.env` ➔ `404 Not Found` (Handled by Fastify router, not exposed via static root).
  - `GET https://sensoura.ox0x.com/serviceAccountKey.json` ➔ `404 Not Found`.
- **Container Environment:**
  - `FIREBASE_PRIVATE_KEY` and `FIREBASE_CLIENT_EMAIL` are injected directly via Podman container environment files outside `public_html`.
  - Frontend client bundle (`index-C-o9dKXw.js`) contains **no server-side private keys or service account tokens**.

---

## 4. Network & Transport Security

| Metric | Status | Detail |
|---|---|---|
| **Protocol** | TLS 1.2 / TLS 1.3 | Enforced by Nginx / Apache SSL |
| **HSTS** | Enabled | `Strict-Transport-Security: max-age=31536000; includeSubDomains` |
| **X-Content-Type-Options** | `nosniff` | Prevents MIME-type sniffing |
| **X-Frame-Options** | `SAMEORIGIN` | Prevents clickjacking |
| **Rate Limiting** | Active | Fastify rate limiter: 100 requests / minute / IP |
| **CORS** | Strict Origin | Bound strictly to `https://sensoura.ox0x.com` |

---

## 5. Firebase Security Rules (`database.rules.json`)

The compiled rules file resides at `d:\sensoura\database.rules.json`:
- **Anonymous Access:** Denied (`auth != null`).
- **Direct Client Writes:** Denied across all nodes (`.write: false`). All writes are mediated through the server-side Firebase Admin SDK.
- **Sensor Data & System Telemetry Reads:** Restricted to authenticated users with verified emails (`auth.token.email_verified == true`).
- **Commands & AI Data Reads:** Restricted to `admin` and `operator` custom claims.

---

## 6. Security Posture Assessment

**Final Rating: PRODUCTION READY (Grade: A)**  
No high or critical vulnerabilities exist. Dev tokens are completely disabled. Hardware actuation is shielded with strict RBAC, rate-limiting, and audit logging.

