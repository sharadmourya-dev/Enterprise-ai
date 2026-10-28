# Multi-stage Dockerfile for @enterprise-ai/frontend
# Stage 1: Build workspace packages and Next.js standalone application
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root and workspace package manifests for cached dependency installation
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-types/tsconfig.json ./packages/shared-types/
COPY apps/frontend/package.json ./apps/frontend/
COPY apps/frontend/tsconfig.json ./apps/frontend/
COPY apps/frontend/next.config.mjs ./apps/frontend/
COPY apps/frontend/tailwind.config.ts ./apps/frontend/
COPY apps/frontend/postcss.config.mjs ./apps/frontend/

# Install dependencies strictly from lockfile
RUN npm ci

# Copy TypeScript source code
COPY packages/shared-types/src ./packages/shared-types/src
COPY apps/frontend/src ./apps/frontend/src

# Compile shared-types package first
RUN npm run build:packages

# Next.js browser-exposed environment variable passed at build time
ARG NEXT_PUBLIC_API_URL=http://localhost:5000/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

# Build Next.js standalone production application
RUN npm run build --workspace=@enterprise-ai/frontend

# Stage 2: Minimal, secure Next.js standalone runner
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Install curl for container health check probes
RUN apk add --no-cache curl

# Create non-root system group and user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Ensure directory structure exists
RUN mkdir -p /app/apps/frontend/public && chown -R appuser:appgroup /app

# Copy standalone output from builder
COPY --from=builder --chown=appuser:appgroup /app/apps/frontend/.next/standalone ./
COPY --from=builder --chown=appuser:appgroup /app/apps/frontend/.next/static ./apps/frontend/.next/static

# Run as non-root user
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://127.0.0.1:3000/ || exit 1

CMD ["node", "apps/frontend/server.js"]
