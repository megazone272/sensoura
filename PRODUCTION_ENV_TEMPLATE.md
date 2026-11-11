# SENSOURA — Production Environment Template

This template documents all production environment variables required by the Sensoura backend runtime.

> [!CAUTION]
> Never commit actual values or production credentials to git repositories or public documents.

---

```ini
# ==============================================================================
# SENSOURA PRODUCTION ENVIRONMENT VARIABLES TEMPLATE
# ==============================================================================

# Node Environment
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
LOG_LEVEL=info

# Mission Identity
MISSION_NAME=SENSOURA
MISSION_PHASE=LUNAR_ANALOG
TEAM_ID=TEAM-MISSION-49

# Public URLs & CORS
# In production, specify the exact origin(s) permitted for CORS and Socket.IO
FRONTEND_URL=https://sensoura.ox0x.com

# Device Authentication
# Must be a cryptographically random hex/base64 string of at least 32 characters
# Insecure/placeholder values cause server startup to fail safely
DEVICE_ID=sensoura-esp32-01
DEVICE_AUTH_TOKEN=0000000000000000000000000000000000000000000000000000000000000000

# Firebase Configuration
# Use Firebase Service Account credentials for Admin SDK initialization
FIREBASE_PROJECT_ID=on-an-official-team
FIREBASE_DATABASE_URL=https://on-an-official-team-default-rtdb.europe-west1.firebasedatabase.app
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-fbsvc@on-an-official-team.iam.gserviceaccount.com
# Provide the private key with newline escapes intact
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEv...YOUR_PRIVATE_KEY_HERE...\n-----END PRIVATE KEY-----\n"

# JWT Security (Optional / Fallback)
# Minimum 32 characters; placeholders strictly forbidden in production
# JWT_SECRET=your_32_character_cryptographically_secure_key_here

# Rate Limiting
API_RATE_LIMIT=100

# AI Pipeline Configuration
AI_ENGINE_ENABLED=true
AI_CONFIDENCE_THRESHOLD=0.85

# Optional SMTP Configuration (cPanel Mailbox)
# SMTP_HOST=mail.sensoura.ox0x.com
# SMTP_PORT=465
# SMTP_SECURE=true
# SMTP_USER=info@sensoura.ox0x.com
# SMTP_PASS=YOUR_CPANEL_MAILBOX_PASSWORD
# SMTP_FROM_NAME="Sensoura"
# SMTP_FROM_EMAIL=info@sensoura.ox0x.com
```
