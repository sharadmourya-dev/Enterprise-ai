# Multi-stage Dockerfile for @enterprise-ai/backend
# Stage 1: Build workspace packages and backend application
FROM node:22-alpine AS builder

WORKDIR /app

# Install native compilation dependencies for packages like bcrypt
RUN apk add --no-cache python3 make g++

# Copy root and workspace package manifests for cached dependency installation
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-types/tsconfig.json ./packages/shared-types/
COPY apps/backend/package.json ./apps/backend/
COPY apps/backend/tsconfig.json ./apps/backend/

# Install dependencies strictly from lockfile
RUN npm ci

# Copy TypeScript source code
COPY packages/shared-types/src ./packages/shared-types/src
COPY apps/backend/src ./apps/backend/src

# Compile shared-types package first, then backend application
RUN npm run build:packages && npm run build --workspace=@enterprise-ai/backend

# Prune development dependencies to produce a clean production tree
RUN npm prune --omit=dev

# Stage 2: Minimal, secure production runner
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5000

# Install curl for container health check probes
RUN apk add --no-cache curl

# Create non-root system group and user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Create uploads storage directory with ownership assigned to non-root user
RUN mkdir -p /app/data/uploads && chown -R appuser:appgroup /app/data

# Copy production node_modules from builder
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder --chown=appuser:appgroup /app/package.json ./package.json

# Copy compiled shared-types
COPY --from=builder --chown=appuser:appgroup /app/packages/shared-types/package.json ./packages/shared-types/package.json
COPY --from=builder --chown=appuser:appgroup /app/packages/shared-types/dist ./packages/shared-types/dist

# Copy compiled backend application
COPY --from=builder --chown=appuser:appgroup /app/apps/backend/package.json ./apps/backend/package.json
COPY --from=builder --chown=appuser:appgroup /app/apps/backend/dist ./apps/backend/dist

# Run as non-root user
USER appuser

EXPOSE 5000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://127.0.0.1:5000/health/readiness || exit 1

CMD ["node", "apps/backend/dist/server.js"]
