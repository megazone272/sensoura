# SENSOURA Backend - Multi-stage Docker Build
# NASA Competition Grade

# ==========================================
# Base stage - dependencies
# ==========================================
FROM node:20-alpine AS base
WORKDIR /app
RUN apk add --no-cache python3 make g++ sqlite-libs
ENV NODE_ENV=production

# ==========================================
# Dependencies stage
# ==========================================
FROM base AS deps
COPY package*.json ./
RUN npm ci --only=production --ignore-scripts && \
    npm cache clean --force

# ==========================================
# Build stage
# ==========================================
FROM base AS builder
COPY package*.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

# ==========================================
# Production stage
# ==========================================
FROM node:20-alpine AS production
WORKDIR /app

# Create non-root user
RUN addgroup -g 1001 -S sensoura && \
    adduser -S sensoura -u 1001 -G sensoura

# Copy production dependencies
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/scripts ./scripts

# Create models directory for AI
RUN mkdir -p /app/models && chown -R sensoura:sensoura /app

USER sensoura

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]