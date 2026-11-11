# SENSOURA — Production Deployment Report

**Deployment Date:** 2026-11-11 22:05 UTC  
**Environment:** Production (`NODE_ENV=production`)  
**Target Host:** `server.ox0x.com` (`65.109.137.42`)  
**Deployment Tooling:** Autonomous SSH + cPanel ea-podman container runtime + Nginx/Apache reverse proxy  
**Commit:** `67c0592` (Production Security Hardening & Final Verification)

---

## 1. Executive Summary

The Sensoura Smart Agriculture Monitoring System has been **successfully deployed and verified in live production**. 

All security hardening changes, including strict dev token blocking, Firebase Service Account resolution, typed sensor payload normalization, role-based access control, and audit logging, are active and operational.

---

## 2. Infrastructure & Endpoints

| Resource | Status | URL / Path |
|---|---|---|
| **Production Website** | 🟢 LIVE (200 OK) | `https://sensoura.ox0x.com/` |
| **Backend Health Endpoint** | 🟢 LIVE (200 OK) | `https://sensoura.ox0x.com/health` |
| **Backend Readiness Endpoint** | 🟢 LIVE (200 OK) | `https://sensoura.ox0x.com/ready` |
| **Socket.IO Real-time Bridge** | 🟢 LIVE (Handshake OK) | `https://sensoura.ox0x.com/socket.io/?EIO=4&transport=polling` |
| **Firebase Admin SDK** | 🟢 CONNECTED (`sdk`) | RTDB: `https://on-an-official-team-default-rtdb.europe-west1.firebasedatabase.app` |
| **AI Inference Engine** | 🟢 OPERATIONAL | Backend: Heuristic + Linear Regression fallback |
| **Hosting Account** | Verified | cPanel User: `pocketwiseox0x` |
| **Container Engine** | Healthy | Podman container: `sensoura-3.pocketwiseox0x.02` |

---

## 3. Deployment Steps Executed

1. **Local SSH Discovery & Authentication:**
   - Discovered SSH key `C:\Users\nour\.ssh\sensoura_deploy`.
   - Connected via `ssh-agent` identity on port `2369` without asking for or exposing passphrases.
2. **Server Architecture Discovery:**
   - Server OS: Linux EL9 (`5.14.0-611.49.2.el9_7.x86_64`).
   - Node runtime inside container: `Node.js v22.23.4`.
   - Routing: Cloudflare/Nginx reverse proxying to Apache, which proxies `127.0.0.1:10000` mapped to container port `3000`.
   - Existing `.htaccess` preserved completely intact.
3. **Safety Backup Created:**
   - Timestamped pre-deployment archive created before any modification:  
     `/home/pocketwiseox0x/sensoura-backup-pre-hardening-20261111_214042.tar.gz` (109 MB).
4. **Local Production Build:**
   - Executed `npm --prefix backend run build` via `scripts/build-cpanel.mjs`.
   - Built frontend assets via Vite: `dist/index.html` + dynamic module chunks.
   - Built backend server via TypeScript compiler (`tsc`).
   - Synced frontend into `dist/public` and `public/`.
5. **Release Upload & Deployment:**
   - Transferred compiled release via encrypted SCP.
   - Extracted cleanly into `/home/pocketwiseox0x/ea-podman.d/sensoura-3.pocketwiseox0x.02/webapp/backend`.
   - Synced public assets to container's web root.
6. **Container Service Restart & Health Verification:**
   - Cleanly restarted Podman container `sensoura-3.pocketwiseox0x.02`.
   - Verified startup logs:
     - `Using env-based Firebase credentials`
     - `Firebase Admin SDK initialized`
     - `Firebase real-time listeners attached`
     - `Frontend static files registered`
     - `Socket.IO initialized`
     - `🚀 SENSOURA Backend started`

---

## 4. Live Verification Results

### A. Health Check (`/health`)
```json
{
  "status": "ok",
  "mission": "SENSOURA",
  "phase": "LUNAR_ANALOG",
  "team": "TEAM-MISSION-49",
  "timestamp": 1794427315848,
  "uptime": 266.99,
  "firebase": "sdk",
  "aiBackend": "fallback"
}
```

### B. Readiness Check (`/ready`)
```json
{
  "ready": true,
  "timestamp": 1794427316461,
  "services": {
    "realtime": true,
    "ai": true,
    "socket": true
  }
}
```

### C. Socket.IO Real-Time Handshake
- Request: `GET https://sensoura.ox0x.com/socket.io/?EIO=4&transport=polling`
- Response:
  ```json
  0{"sid":"mIl7DGTxx3eszTYIAAAA","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
  ```
  Handshake succeeded with SID issued and WebSocket upgrade capability available.

### D. Security Verification
- **Dev Token Rejection:** Sending `Authorization: Bearer dev-admin-bypass-token` to `/api/sensor-data` returns `401 Unauthorized`.
- **Secrecy Preservation:** Requests to `/.env` and `/serviceAccountKey.json` return `404 Not Found`.
- **No Credentials Exposed:** All secrets are bound in private container environment and never written to public directories.

---

## 5. Rollback Information

If a rollback is ever needed, the previous deployment archive is safely preserved on the server:
```bash
ssh -p 2369 pocketwiseox0x@65.109.137.42
tar -xzf ~/sensoura-backup-pre-hardening-20261111_214042.tar.gz -C ~/ea-podman.d/sensoura-3.pocketwiseox0x.02/webapp/
podman restart sensoura-3.pocketwiseox0x.02
```

