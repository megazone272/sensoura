# Secure container deployment

The default Compose setup binds host ports to `127.0.0.1`. Redis has no published host port. Mosquitto, the backend, Vite development server, production frontend, pipeline admin/status service, Grafana, and Prometheus are reachable from the host only through loopback. Do not publish these ports directly to the Internet.

## Provision secrets before starting Compose

Run from the repository root in a Linux shell or WSL. Keep `.local/`, `backend/.env`, and the firmware's local `secrets.h` out of Git. The root `.gitignore` excludes these files.

```bash
install -m 700 -d .local
mosquitto_passwd -c .local/mosquitto.passwd sensoura
chmod 644 .local/mosquitto.passwd # salted hashes only; container needs read access
export MOSQUITTO_PASSWORD_FILE="$PWD/.local/mosquitto.passwd"
export MQTT_USERNAME=sensoura
export MQTT_PASSWORD='use-the-same-password-created-above'
export PIPELINE_ADMIN_TOKEN="$(openssl rand -hex 32)"
export GRAFANA_ADMIN_USER=admin
export GRAFANA_ADMIN_PASSWORD="$(openssl rand -hex 24)"
```

Set the exact password used in `mosquitto_passwd` as `MQTT_PASSWORD`; Compose passes these values to the broker health check and backend client. The broker's `sensoura` account can write only to `sensoura/telemetry/#` and `sensoura/status/#`, and read only from `sensoura/commands/#`. Create separate credentials and narrower ACL entries for each real device before using MQTT with hardware. Anonymous MQTT and WebSocket access are disabled. The host-mapped MQTT and WebSocket ports are loopback-only; remote access requires a separately configured authenticated TLS reverse proxy or an intentional private-network policy.

Create `backend/.env` from `backend/.env.example` and configure Firebase Admin credentials, `DEVICE_ID`, and a unique random `DEVICE_AUTH_TOKEN` of at least 32 characters. Email/Password verification links are sent by Firebase Authentication; enable the Firebase email address verification template and add the frontend hostnames to Authorized domains. No Resend sender/key is required. This configuration currently binds one backend credential pair to one device; do not share that token across devices. Add a server-side device credential registry before scaling to multiple devices. Keep the device token private. Copy `firmware/include/secrets.h.example` to the ignored `firmware/include/secrets.h`, then set the same `DEVICE_ID` and token there, the Wi-Fi credentials, the public HTTPS API origin, and the trusted root CA certificate used by the TLS reverse proxy. The firmware verifies certificates; never replace this with an insecure TLS mode. A token compiled into firmware can be extracted from a physical device, so protect the device network and rotate the token if compromised.

Production backend startup fails closed if Firebase Admin configuration or the device token is missing. Compose also requires the local Mosquitto password-file path, MQTT credentials, and pipeline admin token. Grafana has no repository default password and requires `GRAFANA_ADMIN_USER` and `GRAFANA_ADMIN_PASSWORD` when Compose is evaluated. Prometheus does not enable its lifecycle reload endpoint. Redis and MQTT are not HTTP metrics endpoints; configure separately authenticated exporters only if those metrics are required.

## Start services

```bash
cp backend/.env.example backend/.env
# Edit backend/.env locally before production use.
docker compose --profile production up -d
# For local frontend development instead, use:
# docker compose --profile development up -d
```

The production Nginx container listens on its internal HTTP port 80 and does **not** terminate TLS. To publish the web dashboard, configure a maintained host reverse proxy with certificates, secure WebSocket forwarding, and proxying to `http://127.0.0.1:8080`; do not expose the container port directly. Configure `FRONTEND_URL` with the browser origins that will actually be used. Keep the API/backend and pipeline ports private.

Enable the optional UI/metrics profile only when needed:

```bash
docker compose --profile production --profile monitoring up -d
```

Prometheus and Grafana remain available on loopback (`127.0.0.1:9090` and `127.0.0.1:3001`). The pipeline admin/status endpoint is loopback-only (`127.0.0.1:3100`) and its manual run endpoints require `PIPELINE_ADMIN_TOKEN`.

## Secret handling and verification

Do not commit `.env`, service-account JSON, `.local/`, `firmware/include/secrets.h`, or compiled firmware artifacts. Rotate Firebase service-account credentials, any previously exposed Resend API key, device/API bearer tokens, MQTT credentials, pipeline token, and Grafana credentials if they were ever exposed. Confirm the live firewall, cloud security groups, reverse-proxy TLS/WebSocket settings, Firebase rules and Authorized domains, and GitHub repository protections separately; repository code cannot verify those external controls.
