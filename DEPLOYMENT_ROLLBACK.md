# SENSOURA — Deployment Rollback & Disaster Recovery Runbook

This runbook outlines the exact, deterministic steps to revert the Sensoura production environment to the pre-deployment state if an unrecoverable runtime fault occurs.

---

## 1. Verified Backup Artifacts

Before the deployment on 2026-11-11, a full timestamped backup archive of the application backend and dist was generated on the remote host:

- **Location:** `/home/pocketwiseox0x/sensoura-backup-pre-hardening-20261111_214042.tar.gz`
- **File Size:** ~109 MB
- **Scope:** Complete `backend/` directory, compiled `dist/`, `package.json`, and static assets.

---

## 2. Emergency Rollback Procedure (Single-Command Execution)

Run the following command directly from your local terminal via SSH:

```bash
ssh -p 2369 pocketwiseox0x@65.109.137.42 "
  echo 'Starting Sensoura emergency rollback...';
  tar -xzf /home/pocketwiseox0x/sensoura-backup-pre-hardening-20261111_214042.tar.gz -C /home/pocketwiseox0x/ea-podman.d/sensoura-3.pocketwiseox0x.02/webapp/;
  podman restart sensoura-3.pocketwiseox0x.02;
  echo 'Rollback complete. Checking container status:';
  podman ps -a --filter name=sensoura-3;
"
```

---

## 3. Post-Rollback Health Verification

Verify that the rollback succeeded by calling the health endpoint:

```bash
curl -I https://sensoura.ox0x.com/health
curl https://sensoura.ox0x.com/ready
```

Expected output:
- HTTP status: `200 OK`
- JSON response: `{"status":"ok", ...}`

---

## 4. Container Troubleshooting Commands

If the container fails to start:

1. **Check Logs:**
   ```bash
   ssh -p 2369 pocketwiseox0x@65.109.137.42 "podman logs --tail 50 sensoura-3.pocketwiseox0x.02"
   ```

2. **Inspect Port Bindings:**
   ```bash
   ssh -p 2369 pocketwiseox0x@65.109.137.42 "podman inspect sensoura-3.pocketwiseox0x.02 --format '{{.NetworkSettings.Ports}}'"
   ```

3. **Check Host Port Collision:**
   ```bash
   ssh -p 2369 pocketwiseox0x@65.109.137.42 "ss -tlpn | grep 10000"
   ```

