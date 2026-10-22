import winston from 'winston';
import { env } from '../config/env.js';

const SENSITIVE_KEYS = new Set(['password', 'apikey', 'api_key', 'token', 'secret', 'authorization', 'cookie']);

export const logger = winston.createLogger({
  level: env.NODE_ENV === 'test' ? 'error' : 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf((info) => {
          const { level, message, timestamp, stack, ...meta } = info;
          const cleanMeta: Record<string, any> = {};
          for (const key of Object.keys(meta)) {
            if (key !== 'level' && key !== 'message' && key !== 'timestamp' && key !== 'stack' && key !== 'splat') {
              if (SENSITIVE_KEYS.has(key.toLowerCase())) {
                cleanMeta[key] = '[REDACTED]';
              } else {
                cleanMeta[key] = (meta as any)[key];
              }
            }
          }
          const metaStr = Object.keys(cleanMeta).length > 0 ? ' ' + JSON.stringify(cleanMeta) : '';
          return `${timestamp} [${level}]: ${stack || message}${metaStr}`;
        })
      ),
    }),
  ],
});

export default logger;
