# Security hardening checklist

This repository now enforces several safeguards in code and Compose. A repository change cannot verify settings already deployed in Firebase, a cloud firewall, a reverse proxy, GitHub, or physical pump wiring.

## Implemented in this checkout

- Dashboard sign-up and sign-in use Firebase Email/Password. Password users must follow Firebase's email verification action link before protected access; the backend validates Firebase Admin-verified ID tokens and requires the signed `email_verified` claim. Google/GitHub require provider-verified email. Public accounts without a custom role claim default to read-only Viewer access; roleless identities from other providers are rejected. `admin` and `operator` claims are assigned only by trusted server-side Firebase Admin code. Predictable development tokens are accepted only in development/test.
- Realtime Database Admin access stays server-side. Protected user API routes enforce roles. Do not make the RTDB root or a `testData` node public.
- ESP32 firmware no longer authenticates anonymously to Firebase, writes Firebase URLs directly, or falls back to `/testData`. It uses an HTTPS backend API with a separate bearer token and a configured trusted CA.
- Device telemetry is strict-schema validated, timestamp-bounded, and bound to one configured `DEVICE_ID`. Device command polling returns only fresh, unreported commands for that identity. Results must match a queued command and are protected against duplicate submission in-process.
- ESP32 command execution is one-at-a-time, checks the returned `deviceId`, and retries a pending result before requesting another command. Firmware starts with the relay OFF and has a 60-second software fail-safe that turns the relay OFF after no successful authenticated backend response.
- Device identities are rejected from dashboard Socket.IO. Dashboard sockets authenticate with Firebase ID tokens.
- Compose publishes host ports only on loopback. Redis has no host port. Mosquitto requires a password file, disables anonymous MQTT/WebSocket access, and applies an ACL. Grafana admin credentials and the pipeline admin token have no repository defaults and are required at Compose evaluation. Prometheus does not enable its lifecycle reload endpoint and does not scrape Redis/MQTT as if they were HTTP exporters.
- Firmware secrets, backend `.env`, service-account key files, and `.local/` are ignored by Git. Non-secret templates and operational instructions are provided.

## Required before production rollout

### Firebase and identity

- In the **actual Firebase project**, enable Email/Password only if public account creation and read-only Viewer access for every Email/Password registrant are intended. Disable Anonymous sign-in if unused. Keep Firebase's email verification template enabled and add each application hostname to Authorized domains. Public signup remains read-only Viewer; set `admin` and `operator` custom claims server-side only; never expose role selection or custom-claim assignment in the browser.
- Deploy deny-by-default RTDB rules in the live project. Verify anonymous and ordinary authenticated REST/SDK reads and writes are denied in the Firebase Rules Simulator. Confirm there is no public `.read`, `.write`, or test-data fallback. Admin SDK access bypasses these rules; backend route authorization remains mandatory.
- Use the project's exact ID, RTDB URL, and Web API key. Keep service-account credentials backend-only. Restrict and rotate service-account credentials if they were ever exposed.
- The current backend configuration supports one `DEVICE_ID`/`DEVICE_AUTH_TOKEN` pair. Do not reuse that token across physical devices. Implement a per-device credential registry before scaling beyond one device.

### Deployment and secrets

- Follow [`docker/SECURITY.md`](../docker/SECURITY.md): create the local Mosquitto password file, export runtime variables, configure Firebase Admin credentials, generate strong device/pipeline/Grafana secrets, and never commit them. Add stronger bot protection (for example, CAPTCHA/App Check) before promoting public registration at scale.
- Put the production Nginx frontend behind a maintained TLS reverse proxy; verify certificates, secure WebSocket forwarding, `Authorization` header forwarding, host/origin allowlists, firewall rules, cloud security groups, and rate limits. Keep backend, pipeline, metrics, Redis, and broker ports private; do not change loopback binds without an explicit network/security design.
- If MQTT is used by devices, provision unique broker credentials and per-device ACLs; the current `sensoura` ACL identity is a constrained shared integration account and the ESP32 no longer uses MQTT.
- Run dependency and secret scans before release; configure Dependabot/security alerts, secret scanning and push protection, required CI checks, and protected branches in the GitHub repository settings.

### Physical device safety

- Before connecting a pump, bench-test boot with relay OFF, power loss, Wi-Fi loss, backend outage, invalid/expired TLS certificates, stale or duplicated commands, result-report retries, and a reboot command. Confirm the physical relay and pump reach the intended safe OFF state.
- Verify the 60-second software network fail-safe on the actual hardware, and use an independent hardware interlock/watchdog where pump flooding, dry-run, or unintended watering could cause harm. Software behavior is not a safety-rated substitute for hardware protection.
- Confirm sensor calibration and pressure/temperature bounds; rejected telemetry should be investigated rather than bypassed by widening validation without evidence.

## Evidence boundary

This checklist describes source and configuration in this checkout. It does not assert that the live Firebase rules, Firebase sign-in settings, custom claims, certificates, public firewall, reverse proxy, GitHub protection settings, or physical safe state have been changed or verified. Validate each in its own control plane before making the service publicly reachable or attaching an actuator.
