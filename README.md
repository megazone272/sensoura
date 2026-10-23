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

```bash
# Clone/navigate to project
cd D:\sensoura

# Copy environment files
cp backend/.env.example backend/.env

# Start all services
docker-compose up -d

# With monitoring (Grafana + Prometheus)
docker-compose --profile monitoring up -d

# Check health
./scripts/health-check.sh --verbose
```

Access:
- Dashboard: http://localhost:5173
- Backend API: http://localhost:3000
- Grafana: http://localhost:3001 (admin/sensoura2024)
- Prometheus: http://localhost:9090

### Option 2: Manual

```bash
# Backend
# --ignore-scripts skips the @tensorflow/tfjs-node native build (needs MSVC/Python).
# Until the binding is built, the AI engine runs heuristic + ml-regression fallbacks.
cd backend
npm install --ignore-scripts
cp .env.example .env
# Edit .env with your Firebase credentials — or just drop the service account
# JSON in backend/serviceAccountKey.json (auto-detected, no env vars needed)
npm run dev

# Frontend (new terminal)
cd frontend
npm install
npm run dev

# Optional: build the TensorFlow.js native binding later (needs MSVC Build Tools,
# Python 3.11+, and a compatible Node ABI):
cd backend
npm rebuild @tensorflow/tfjs-node --build-from-source

# Redis (new terminal)
docker run -p 6379:6379 redis:alpine

# MQTT (new terminal)
docker run -p 1883:1883 eclipse-mosquitto
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

### Firebase Integration
The ESP32 connects to Firebase Realtime Database:
- **Reads**: `/Sensoura/commands/*` - Execute commands
- **Writes**: `/Sensoura/sensorData/*` - Publish readings
- **Writes**: `/Sensoura/system/*` - Update device status
- **Writes**: `/Sensoura/commandResults/*` - Report execution

---

## 🔥 Firebase Configuration

### 1. Create Project
1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create new project: `on-an-official-mission`
3. Enable Realtime Database (europe-west1 region)

### 2. Enable Anonymous Auth
1. Authentication → Sign-in method
2. Enable Anonymous authentication

### 3. Database Rules
```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "testData": {
      ".read": "true",
      ".write": "true"
    }
  }
}
```

### 4. Generate Service Account Key
1. Project Settings → Service accounts
2. Generate new private key
3. Save as `backend/serviceAccountKey.json`
4. Update `backend/.env`:
```env
FIREBASE_PROJECT_ID=on-an-official-mission
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@on-an-official-mission.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_DATABASE_URL=https://on-an-official-mission-default-rtdb.europe-west1.firebasedatabase.app
```

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
