# 🌱 SENSOURA - Smart Agriculture IoT System

**NASA Competition Grade** | Mission: Lunar Analog | Team: TEAM-MISSION-49

An end-to-end IoT system for monitoring and controlling agricultural environments, with AI-powered predictions and real-time dashboard.

---

## 📋 Table of Contents

- [Architecture](#architecture)
- [Features](#features)
- [Tech Stack](#tech-stack)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [API Documentation](#api-documentation)
- [ESP32 Firmware](#esp32-firmware)
- [Firebase Configuration](#firebase-configuration)
- [Docker Deployment](#docker-deployment)
- [Development](#development)
- [Testing](#testing)
- [Contributing](#contributing)

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        SENSOURA SYSTEM                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────┐     ┌──────────────┐     ┌──────────────────┐   │
│  │  ESP32   │────▶│   Firebase   │────▶│  Node.js Backend │   │
│  │ Sensors  │     │  Realtime DB │     │   + Socket.IO    │   │
│  │ +Actuators│◀────│              │◀────│   + AI Engine    │   │
│  └──────────┘     └──────────────┘     └──────────────────┘   │
│                                                 │               │
│                                                 ▼               │
│                                        ┌──────────────────┐   │
│                                        │  React Dashboard │   │
│                                        │   (WebSocket)    │   │
│                                        └──────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Components

| Component | Technology | Port |
|-----------|-----------|------|
| ESP32 Firmware | Arduino/C++ | - |
| Firebase Realtime DB | Google Cloud | - |
| Node.js Backend | Fastify + Socket.IO | 3000 |
| React Frontend | Vite + React + Zustand | 5173 |
| AI Engine | TensorFlow.js | - |
| Redis | Job Queue / Cache | 6379 |
| MQTT Broker | Mosquitto | 1883 |
| Grafana | Metrics Dashboard | 3001 |
| Prometheus | Metrics Collection | 9090 |

---

## ✨ Features

### 📊 Real-time Monitoring
- 7 sensors: Temperature, Soil Temp, Humidity, Soil Moisture, Gas, Light, Air Pressure
- Live updates via WebSocket (no refresh needed)
- Historical data charts (Recharts)

### 🤖 AI-Powered Suggestions
- **Irrigation Prediction**: ML model predicts soil moisture levels
- **Gas Level Warning**: Detects rising gas trends before they become critical
- **Temperature Stress Alert**: Predicts extreme temperatures
- **Harvest Estimation**: Estimates optimal harvest timing
- Confidence scores for each suggestion
- Manual approval workflow

### 🎮 Device Control
- Manual pump control (ON/OFF)
- Buzzer mute/unmute
- System reboot & calibration
- Command history tracking

### 📈 Metrics & Monitoring
- Prometheus metrics endpoint
- Grafana dashboards (optional)
- Health checks
- Structured logging (Pino)

---

## 🛠 Tech Stack

### Backend
- **Runtime**: Node.js 20+
- **Framework**: Fastify 4.x
- **Language**: TypeScript
- **Real-time**: Socket.IO 4.x
- **AI/ML**: TensorFlow.js + ml-regression
- **Queue**: BullMQ + Redis
- **Logging**: Pino
- **Validation**: Zod
- **MQTT**: MQTT.js

### Frontend
- **Framework**: React 18
- **Build Tool**: Vite 5
- **Language**: TypeScript
- **State**: Zustand
- **Charts**: Recharts
- **Styling**: CSS Variables + Custom Design System
- **Icons**: Lucide React
- **Real-time**: Socket.IO Client

### Infrastructure
- **Database**: Firebase Realtime Database
- **Container**: Docker + Docker Compose
- **Web Server**: Nginx (production)
- **Monitoring**: Prometheus + Grafana

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- Docker & Docker Compose (optional)
- Firebase account (optional for local dev)

### Option 1: Docker (Recommended)

Before a live deployment, follow the [security hardening checklist](docs/security-hardening.md) and [container runbook](docker/SECURITY.md).

```bash
# Clone/navigate to project
cd D:\sensoura

# Copy environment files
cp backend/.env.example backend/.env

# Before starting, configure backend/.env and follow docker/SECURITY.md to create
# the local Mosquitto password file and export the required runtime secrets.

# Choose ONE frontend profile: local Vite development or production Nginx.
docker compose --profile development up -d
# Alternatively: docker compose --profile production up -d

# Production frontend plus optional monitoring (set Grafana credentials first)
# docker compose --profile production --profile monitoring up -d

# Check health
./scripts/health-check.sh --verbose
```

Access:
- Development dashboard: http://localhost:5173
- Production frontend behind an external TLS reverse proxy: http://127.0.0.1:8080
- Backend API (local diagnostics only): http://127.0.0.1:3000
- Grafana (monitoring profile, configure a unique admin credential first): http://127.0.0.1:3001
- Prometheus: http://localhost:9090

### Option 2: Manual

```bash
# Backend
# --ignore-scripts skips the @tensorflow/tfjs-node native build (needs MSVC/Python).
# Until the binding is built, the AI engine runs heuristic + ml-regression fallbacks.
cd backend
npm install --ignore-scripts
cp .env.example .env
# Fill backend/.env with your Firebase Admin credentials. The backend reads
# process.env; export the values in your shell/secret manager before this command.
set -a && . ./.env && set +a
npm run dev

# Frontend (new terminal)
cd frontend
npm install
npm run dev

# Optional: build the TensorFlow.js native binding later (needs MSVC Build Tools,
# Python 3.11+, and a compatible Node ABI):
cd backend
npm rebuild @tensorflow/tfjs-node --build-from-source

# Redis and MQTT are internal Compose services. Do not publish unauthenticated
# standalone instances; use the loopback-bound configuration in docker/SECURITY.md.
```

---

## 📁 Project Structure

```
sensoura/
├── backend/                    # Node.js Backend
│   ├── src/
│   │   ├── config/            # Environment & Firebase config
│   │   ├── controllers/       # Request handlers
│   │   ├── services/          # Business logic
│   │   │   ├── firebase.ts    # Firebase Admin SDK
│   │   │   └── realtime.ts    # Real-time state management
│   │   ├── models/            # TypeScript interfaces & Zod schemas
│   │   ├── routes/            # API routes
│   │   ├── socket/            # Socket.IO server
│   │   ├── ai/                # AI/ML engine
│   │   │   ├── engine.ts      # TensorFlow.js models
│   │   │   ├── pipeline/      # Data-integration / decision / prediction pipelines
│   │   │   │   ├── calibration/   # Calibration artifacts: load, validate, apply
│   │   │   │   ├── cycle/         # Decision & prediction cycles
│   │   │   │   ├── decision/      # Rule-based decision engine
│   │   │   │   ├── prediction/    # Prediction engine
│   │   │   │   ├── integrations/  # Open-Meteo / NASA POWER clients
│   │   │   │   ├── processing/    # Normalization & matching
│   │   │   │   ├── scheduler/     # Independent schedules + job locks
│   │   │   │   ├── storage/       # Versioned Firebase records
│   │   │   │   └── utils/         # Units, timestamps, quality checks
│   │   │   ├── training/      # Offline calibration training (npm run ai:train)
│   │   │   └── train.ts       # Training CLI
│   │   ├── utils/             # Logger & helpers
│   │   └── index.ts           # Entry point
│   ├── datasets/calibration/  # Paired reference measurements (operator-supplied)
│   ├── models/calibration/    # Trained calibration artifacts (generated)
│   ├── scripts/               # Utility scripts
│   ├── tests/                 # Tests
│   ├── Dockerfile
│   └── package.json
│
├── frontend/                   # React Frontend
│   ├── src/
│   │   ├── components/        # Reusable components
│   │   │   └── Layout.tsx     # Main layout with sidebar
│   │   ├── pages/             # Page components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Sensors.tsx
│   │   │   ├── Commands.tsx
│   │   │   ├── AISuggestions.tsx
│   │   │   ├── Settings.tsx
│   │   │   └── NotFound.tsx
│   │   ├── services/          # API & Socket clients
│   │   │   ├── api.ts         # REST API client
│   │   │   └── socket.ts      # Socket.IO client
│   │   ├── store/             # Zustand state
│   │   │   └── sensorStore.ts # Global state
│   │   ├── shared/            # Shared types
│   │   ├── styles/            # Global CSS
│   │   └── main.tsx           # Entry point
│   ├── public/
│   ├── Dockerfile.dev
│   ├── Dockerfile.prod
│   ├── nginx.conf
│   └── package.json
│
├── firmware/                   # ESP32 Firmware
│   ├── src/
│   ├── lib/
│   └── platformio.ini
│
├── docker/                     # Docker configs
│   ├── mosquitto.conf
│   └── prometheus.yml
│
├── docs/                       # Documentation
│   └── ai-pipeline.md          # Pipeline, Firebase layout & calibration reference
├── architecture/               # Architecture diagrams
├── scripts/                    # Utility scripts
│   └── health-check.sh
│
└── docker-compose.yml
```

---

## 📡 API Documentation

### Base URL: `http://localhost:3000/api`

### State Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/state` | Full system state |
| GET | `/sensor-data` | Current sensor readings |
| GET | `/system` | System status |
| GET | `/commands` | Command queue |
| GET | `/command-results` | Command execution results |
| GET | `/ai-suggestions` | AI suggestions |

### Control Endpoints
| Method | Endpoint | Body | Description |
|--------|----------|------|-------------|
| POST | `/command` | `{target, action, mode}` | Send command |
| POST | `/relay` | `{state, reason}` | Control pump |
| POST | `/buzzer` | `{action}` | Control buzzer |
| POST | `/system/reboot` | - | Reboot ESP32 |
| POST | `/system/calibrate` | - | Calibrate sensors |

### AI Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/ai/predictions` | Get AI predictions |
| GET | `/ai/model-info` | Model metadata |
| POST | `/ai/retrain` | Trigger retraining |

### AI Suggestions
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/ai-suggestions/:id/approve` | Approve & execute |
| POST | `/ai-suggestions/:id/reject` | Reject suggestion |

### Monitoring
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/health` | Health check |
| GET | `/ready` | Readiness check |
| GET | `/metrics` | Prometheus metrics |

### WebSocket Events

**Client → Server:**
- `command` - Send device command
- `approveSuggestion` - Approve AI suggestion
- `rejectSuggestion` - Reject AI suggestion
- `relayControl` - Control pump relay
- `buzzerControl` - Control buzzer
- `telemetry` - Device telemetry (ESP32)
- `subscribe` / `unsubscribe` - Stream management

**Server → Client:**
- `init` - Initial state on connect
- `sensorData` - Sensor updates
- `system` - System status updates
- `commands` - Command queue updates
- `commandResults` - Execution results
- `aiSuggestions` - Suggestion updates
- `commandResult` - Command acknowledgment
- `suggestionUpdate` - Suggestion status change

---

## 🔧 ESP32 Firmware

### Hardware Requirements
- ESP32-S3 N16R8
- DHT11 (Temperature + Humidity)
- DS18B20 (Soil Temperature)
- Soil Moisture Sensor
- MQ135 (Gas/Air Quality)
- Photoresistor (Light)
- BMP180 (Air Pressure)
- Relay Module (Water Pump)
- Buzzer
- LEDs (Green + Red)

### Setup
```bash
cd firmware
pio run -t upload
pio device monitor
```

### Authenticated API transport
The ESP32 never connects directly to Firebase and never falls back to `/testData`.
It sends validated telemetry, polls device-scoped commands, and reports command
results through the backend HTTPS API using a unique device bearer token. Copy
`firmware/include/secrets.h.example` to the ignored `firmware/include/secrets.h`
and configure its HTTPS origin, trusted TLS root CA, `DEVICE_ID`, and
`DEVICE_AUTH_TOKEN` to match the ignored `backend/.env`. See the
[container security instructions](docker/SECURITY.md).

---

## 🔥 Firebase Configuration

### 1. Create Project
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create or select your project and note its exact project ID and database URL.
3. Enable Realtime Database (europe-west1 region)

### 2. Configure user authentication
1. Authentication → Sign-in method → enable **Email/Password** and **Google**.
2. Enable **GitHub** in the same provider list. Create a GitHub OAuth App and
   set its callback to the exact Firebase OAuth redirect URI shown in the
   provider settings. Keep the GitHub Client Secret in Firebase Console only.
3. Public Email/Password, Google and GitHub accounts receive read-only `viewer` access
   when no role claim is set. Other roleless Firebase providers are rejected;
   Viewers cannot control devices.
4. Assign `admin` or `operator` claims only through trusted Firebase Admin code.
   Never assign roles from the browser. See [Firebase Auth setup](docs/firebase-auth.md).
5. Set `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, and
   `VITE_FIREBASE_PROJECT_ID` in `frontend/.env.local` for local development
   and as build-time variables for production. These are public Web app values,
   not service-account credentials; Firebase Admin credentials stay backend-only.
6. Add the local hostname (`127.0.0.1` or `localhost`, whichever you use) and
   production hostname to Firebase Authentication's **Authorized domains**.
7. Email/Password registration uses Firebase's email address verification link.
   Users must click the link and sign in again before they can access the
   dashboard. No Resend key or custom sender domain is needed for this flow.
   Google/GitHub use their provider-verified
   email. See the Firebase Auth setup guide for details.

### 3. Database Rules
```json
{
  "rules": {
    ".read": false,
    ".write": false
  }
}
```
The backend uses Firebase Admin credentials and enforces user roles on its own
API; Admin SDK operations bypass Realtime Database rules. Keep rules locked for
direct clients, and use the Firebase Rules Simulator to test the actual
production database before rollout. Never make `/testData` or production data
publicly readable or writable.

### 4. Generate Service Account Key
1. Project Settings → Service accounts
2. Create a new service-account credential
3. Save the downloaded JSON in a protected location; never commit it.
4. For the recommended Compose setup, provide the service-account email/private
   key and database URL through the ignored backend environment or a managed
   secret store. If you use a JSON file instead, mount it read-only into the
   container and set `FIREBASE_SERVICE_ACCOUNT_PATH` to the mounted path.
   Update `backend/.env` with the project id, client email and database URL:
```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_DATABASE_URL=https://your-project-id-default-rtdb.europe-west1.firebasedatabase.app
```

If the JSON file cannot be shipped with the deployment, copy the credential
from it into `.env` following the commented template in `backend/.env.example`.
Real credentials are never committed to this repository.

### 5. Initial Data Structure
```json
{
  "Sensoura": {
    "sensorData": {
      "AirTemp": 28.4,
      "SoilTemp": 22.5,
      "AirHumidity": 65.0,
      "SoilMoisture": 24.0,
      "VOC": 185,
      "Light": 60,
      "Barometricpressure": 1013.25,
      "lastUpdate": 1791864000000
    },
    "system": {
      "status": "online",
      "lastSeen": 1791864000000,
      "deviceId": "sensoura-esp32-01",
      "relay": {
        "mode": "AUTO",
        "state": "ON",
        "reason": "soil_dry",
        "lastAction": 1791864000000
      },
      "buzzer": { "muted": false },
      "leds": { "green": false, "red": true }
    },
    "commands": {},
    "commandResults": {},
    "aiSuggestions": {},
    "aiPredictions": {}
  }
}
```

The `sensorData` keys above are the database contract used by the firmware,
this backend and the dashboard. `npm run db:push` seeds the tree as shown;
`aiPredictions` is created only while it is missing, seeded with the two
prediction records from `sensoura-initial-data.json`, and is never overwritten
afterwards — not even with `--force`.

---

## 🐳 Docker Deployment

### Services
| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| backend | Custom | 3000 | API + Socket.IO |
| frontend-dev | Custom | 5173 | Dev dashboard |
| frontend | Nginx | 80/443 | Production dashboard |
| redis | Redis Alpine | 6379 | Job queue |
| mosquitto | Eclipse Mosquitto | 1883/9001 | MQTT broker |
| grafana | Grafana | 3001 | Metrics UI |
| prometheus | Prometheus | 9090 | Metrics collection |

### Commands
```bash
# Start core services
docker-compose up -d

# Start with monitoring
docker-compose --profile monitoring up -d

# Start production frontend
docker-compose --profile production up -d

# View logs
docker-compose logs -f backend

# Stop all
docker-compose down

# Rebuild
docker-compose build --no-cache
```

---

## 💻 Development

### Backend
```bash
cd backend
npm run dev          # Start dev server with hot reload
npm run build        # Build TypeScript
npm run test         # Run tests
npm run lint         # Lint code
npm run typecheck    # Type checking
```

### AI pipelines (data integration → decision → prediction)

The pipeline runs as its own process, separate from the API server. See
[docs/ai-pipeline.md](docs/ai-pipeline.md) for the full reference.

```bash
cd backend
npm run pipeline        # Scheduler: decision every 30 min, prediction once a day
npm run pipeline:once   # Run both cycles once and exit
npm run ai:train        # Fit a calibration model from paired reference data
npm run inspect:legacy  # Read-only: inspect the existing aiPredictions node
```

`npm run ai:train` needs paired reference measurements in
`backend/datasets/calibration/` (format documented in
[backend/datasets/calibration/README.md](backend/datasets/calibration/README.md)).
Without them it reports that and exits non-zero — it never invents a model.

### Frontend
```bash
cd frontend
npm run dev          # Start Vite dev server
npm run build        # Production build
npm run preview      # Preview production build
npm run lint         # Lint code
```

---

## 🧪 Testing

```bash
# Run all health checks
./scripts/health-check.sh --verbose

# Backend tests
cd backend && npm test

# Frontend tests
cd frontend && npm test
```

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

---

## 📄 License

This project is part of the NASA Competition. All rights reserved.

---

## 👥 Team

**Team ID**: TEAM-MISSION-49
**Mission Phase**: LUNAR_ANALOG
**Email**: missionofficial49@gmail.com

---

## 🙏 Acknowledgments

- NASA Competition organizers
- ESP32 community
- Firebase team
- Open source contributors
