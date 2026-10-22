import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import routes from './routes/index.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { NotFoundError } from './utils/errors.js';
import { env } from './config/env.js';

/**
 * Parses the TRUST_PROXY environment configuration into the appropriate
 * format expected by Express.js app.set('trust proxy', ...).
 * - 'false', '0', '' -> boolean false (direct access, no proxies trusted)
 * - 'true' -> boolean true (trust all proxies - discouraged)
 * - '1', '2', etc. -> number 1, 2 (exact hop count)
 * - 'loopback', 'linklocal', 'uniquelocal' or CIDRs -> string or comma-separated list
 */
export function parseTrustProxy(val: string | undefined): boolean | number | string {
  if (!val || val === 'false' || val === '0') {
    return false;
  }
  if (val === 'true') {
    return true;
  }
  const numeric = Number(val);
  if (!Number.isNaN(numeric) && Number.isInteger(numeric) && numeric > 0) {
    return numeric;
  }
  return val;
}

export function createApp(trustProxyOverride?: boolean | number | string): Express {
  const app = express();

  // Trusted proxy configuration (enables correct client IP derivation behind load balancer/proxy)
  const trustProxySetting =
    trustProxyOverride !== undefined ? trustProxyOverride : parseTrustProxy(env.TRUST_PROXY);
  app.set('trust proxy', trustProxySetting as any);

  // Security headers & CORS
  app.use(helmet());
  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'x-request-id'],
    })
  );

  // Body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Attach Request ID to every incoming request
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.requestId = crypto.randomUUID();
    next();
  });

  // Mount API routes
  app.use(routes);

  // 404 handler
  app.use((req: Request, _res: Response, next: NextFunction) => {
    next(new NotFoundError(`Endpoint '${req.method} ${req.originalUrl}' not found`));
  });

  // Global error handler
  app.use(errorHandler);

  return app;
}

export const app = createApp();
