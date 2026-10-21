#!/bin/bash
# SENSOURA Health Check Script
# NASA Competition Grade
# Usage: ./health-check.sh [--verbose]

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuration
BACKEND_URL="${BACKEND_URL:-http://localhost:3000}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:5173}"
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"
MQTT_HOST="${MQTT_HOST:-localhost}"
MQTT_PORT="${MQTT_PORT:-1883}"

VERBOSE=false
if [[ "${1:-}" == "--verbose" ]]; then
    VERBOSE=true
fi

# Counters
TOTAL=0
PASSED=0
FAILED=0

# Functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_pass() { echo -e "${GREEN}[PASS]${NC} $1"; PASSED=$((PASSED + 1)); }
log_fail() { echo -e "${RED}[FAIL]${NC} $1"; FAILED=$((FAILED + 1)); }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

check() {
    local name="$1"
    local command="$2"
    TOTAL=$((TOTAL + 1))

    if eval "$command" > /dev/null 2>&1; then
        log_pass "$name"
    else
        log_fail "$name"
        if $VERBOSE; then
            echo "  Command: $command"
        fi
    fi
}

check_verbose() {
    local name="$1"
    local command="$2"
    TOTAL=$((TOTAL + 1))

    echo -e "${BLUE}[CHECK]${NC} $name"
    if eval "$command"; then
        log_pass "$name"
    else
        log_fail "$name"
    fi
}

# Start
echo ""
echo "=========================================="
echo "  SENSOURA Health Check"
echo "  Mission: LUNAR_ANALOG"
echo "  Team: TEAM-MISSION-49"
echo "=========================================="
echo ""

# 1. Backend Health
log_info "Checking Backend..."
check "Backend /health endpoint" "curl -sf $BACKEND_URL/health"
check "Backend /ready endpoint" "curl -sf $BACKEND_URL/ready"
check "Backend /metrics endpoint" "curl -sf $BACKEND_URL/metrics"

# 2. Frontend
log_info "Checking Frontend..."
check "Frontend is accessible" "curl -sf $FRONTEND_URL"

# 3. Redis
log_info "Checking Redis..."
check "Redis ping" "redis-cli -h $REDIS_HOST -p $REDIS_PORT ping"

# 4. MQTT Broker
log_info "Checking MQTT Broker..."
check "MQTT port is open" "timeout 5 bash -c '</dev/tcp/$MQTT_HOST/$MQTT_PORT'"

# 5. Docker Services (if running in Docker)
if command -v docker &> /dev/null; then
    log_info "Checking Docker Services..."
    check "Redis container" "docker ps --format '{{.Names}}' | grep -q sensoura-redis"
    check "Mosquitto container" "docker ps --format '{{.Names}}' | grep -q sensoura-mqtt"
    check "Backend container" "docker ps --format '{{.Names}}' | grep -q sensoura-backend"
fi

# 6. Firebase (if configured)
log_info "Checking Firebase..."
if [[ -n "${FIREBASE_PROJECT_ID:-}" ]]; then
    check "Firebase project configured" "[[ -n '$FIREBASE_PROJECT_ID' ]]"
else
    log_warn "Firebase not configured (running in mock mode)"
fi

# 7. AI Models
log_info "Checking AI Models..."
if [[ -d "./backend/models" ]]; then
    check "Models directory exists" "[[ -d ./backend/models ]]"
    if ls ./backend/models/*.json 2>/dev/null; then
        log_pass "Model files found"
    else
        log_warn "No model files found (will train on startup)"
    fi
else
    log_warn "Models directory not found"
fi

# Summary
echo ""
echo "=========================================="
echo "  Summary"
echo "=========================================="
echo -e "Total:  $TOTAL"
echo -e "Passed: ${GREEN}$PASSED${NC}"
echo -e "Failed: ${RED}$FAILED${NC}"
echo ""

if [[ $FAILED -eq 0 ]]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some checks failed${NC}"
    exit 1
fi
