import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load .env file from repository root if present
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });
dotenv.config(); // Fallback to local .env

export const KNOWN_INSECURE_SECRETS = [
  'development_access_secret_min_32_characters_long_12345',
  'development_refresh_secret_min_32_characters_long_12345',
  'development_hmac_secret_min_32_characters_long_12345',
  'replace_with_strong_256_bit_random_secret_for_access_tokens',
  'replace_with_strong_256_bit_random_secret_for_refresh_tokens',
  'replace_with_strong_256_bit_random_secret_for_audit_logs',
];

/**
 * Strict boolean parser that correctly interprets boolean representations from environment strings:
 * - "true", "1" -> true
 * - "false", "0" -> false
 * - undefined / empty string -> default value
 * Rejects unsupported strings with a clear validation error.
 */
export const booleanEnv = (defaultValue: boolean) =>
  z
    .preprocess((val) => {
      if (val === undefined || val === '') return defaultValue;
      if (typeof val === 'boolean') return val;
      if (typeof val === 'string') {
        const normalized = val.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
        return val;
      }
      return val;
    }, z.boolean({ invalid_type_error: 'Must be a valid boolean representation ("true", "false", "1", "0")' }))
    .default(defaultValue);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().default(5000),
    FRONTEND_URL: z.string().default('http://localhost:3000'),
    API_BASE_URL: z.string().default('http://localhost:5000/api/v1'),
    TRUST_PROXY: z.string().default('loopback'),

    // MongoDB
    MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/enterprise_ai?replicaSet=rs0&directConnection=true'),
    MONGODB_TEST_URI: z.string().default('mongodb://127.0.0.1:27017/enterprise_ai_test?replicaSet=rs0&directConnection=true'),

    // Redis
    REDIS_HOST: z.string().default('localhost'),
    REDIS_PORT: z.coerce.number().default(6379),
    REDIS_USERNAME: z.string().optional().default('default'),
    REDIS_PASSWORD: z.string().optional().default(''),
    REDIS_TLS: booleanEnv(false),

    // Qdrant
    QDRANT_URL: z.string().default('http://localhost:6333'),
    QDRANT_TEST_URL: z.string().default('http://localhost:6333'),
    QDRANT_API_KEY: z.string().optional().default(''),
    QDRANT_COLLECTION_NAME: z.string().default('enterprise_knowledge_chunks'),

    // JWT & Security Secrets
    JWT_ACCESS_SECRET: z.string().optional(),
    JWT_REFRESH_SECRET: z.string().optional(),
    JWT_ACCESS_EXPIRATION: z.string().default('15m'),
    JWT_REFRESH_EXPIRATION: z.string().default('7d'),
    AUDIT_LOG_HMAC_SECRET: z.string().optional(),

    // AI Settings
    LLM_PROVIDER: z.enum(['gemini', 'openai']).default('gemini'),
    GEMINI_API_KEY: z.string().optional().default(''),
    OPENAI_API_KEY: z.string().optional().default(''),
    GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
    GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-2'),
    OPENAI_MODEL: z.string().default('gpt-4o-mini'),
    OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

    // Ingestion & RAG
    CHUNK_SIZE: z.coerce.number().default(500),
    CHUNK_OVERLAP: z.coerce.number().default(50),
    RAG_TOP_K: z.coerce.number().default(5),
    RAG_SIMILARITY_THRESHOLD: z.coerce.number().default(0.65),
    MAX_FILE_SIZE_BYTES: z.coerce.number().default(52428800),
    UPLOAD_STORAGE_PATH: z.string().default('./data/uploads'),

    // Storage Driver & Cloudinary
    STORAGE_DRIVER: z.enum(['local', 'cloudinary']).default('local'),
    CLOUDINARY_CLOUD_NAME: z.string().optional().default(''),
    CLOUDINARY_API_KEY: z.string().optional().default(''),
    CLOUDINARY_API_SECRET: z.string().optional().default(''),
    CLOUDINARY_FOLDER: z.string().default('enterprise-ai/documents'),
    MAX_CLOUDINARY_FILE_SIZE_BYTES: z.coerce.number().default(10485760), // 10 MB default for Cloudinary free plan

    // Conversation & Multi-Turn
    CONVERSATION_HISTORY_LIMIT: z.coerce.number().min(1).max(50).default(10),
    CONVERSATION_MESSAGE_MAX_CHARS: z.coerce.number().min(10).max(20000).default(4000),

    // Redis Cache
    RAG_CACHE_ENABLED: booleanEnv(true),
    RAG_CACHE_TTL_SECONDS: z.coerce.number().min(10).max(604800).default(3600),
    RAG_CACHE_MAX_PAYLOAD_BYTES: z.coerce.number().min(1024).max(5242880).default(131072), // 128KB default

    // Rate limiting
    RATE_LIMIT_ENABLED: booleanEnv(true),
    RATE_LIMIT_WINDOW_MS: z.coerce.number().min(1000).default(900000),
    RATE_LIMIT_MAX_REQUESTS: z.coerce.number().min(1).default(100),
    RATE_LIMIT_CHAT_WINDOW_MS: z.coerce.number().min(1000).default(60000), // 1 min window
    RATE_LIMIT_CHAT_MAX_REQUESTS: z.coerce.number().min(1).default(20), // 20 chat requests/min
    RATE_LIMIT_CONVERSATION_MAX_REQUESTS: z.coerce.number().min(1).default(30),
    RATE_LIMIT_HISTORY_MAX_REQUESTS: z.coerce.number().min(1).default(60),

    // SSE Streaming
    SSE_HEARTBEAT_INTERVAL_MS: z.coerce.number().min(1000).default(15000),
    REDIS_OPERATION_TIMEOUT_MS: z.coerce.number().min(100).default(3000),
  })
  .superRefine((data, ctx) => {
    const isProduction = data.NODE_ENV === 'production';

    const checkSecret = (
      fieldName: 'JWT_ACCESS_SECRET' | 'JWT_REFRESH_SECRET' | 'AUDIT_LOG_HMAC_SECRET',
      defaultVal: string
    ) => {
      const val = data[fieldName];

      if (isProduction) {
        if (!val || val.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [fieldName],
            message: `FATAL CONFIGURATION ERROR: ${fieldName} must be explicitly provided in production.`,
          });
          return;
        }

        if (val.length < 32) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [fieldName],
            message: `FATAL CONFIGURATION ERROR: ${fieldName} must be at least 32 characters long in production.`,
          });
          return;
        }

        const isKnownInsecure =
          KNOWN_INSECURE_SECRETS.includes(val) ||
          val.startsWith('development_') ||
          val.startsWith('replace_with_');

        if (isKnownInsecure) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [fieldName],
            message: `FATAL CONFIGURATION ERROR: ${fieldName} cannot use known development default or template placeholder values in production.`,
          });
          return;
        }
      } else {
        // In development or test, supply safe defaults if omitted
        if (!val) {
          data[fieldName] = defaultVal;
        }
      }
    };

    checkSecret('JWT_ACCESS_SECRET', 'development_access_secret_min_32_characters_long_12345');
    checkSecret('JWT_REFRESH_SECRET', 'development_refresh_secret_min_32_characters_long_12345');
    checkSecret('AUDIT_LOG_HMAC_SECRET', 'development_hmac_secret_min_32_characters_long_12345');

    // Conditional Cloudinary validation: only required when STORAGE_DRIVER is 'cloudinary'
    if (data.STORAGE_DRIVER === 'cloudinary') {
      const requiredCloudinaryFields: Array<'CLOUDINARY_CLOUD_NAME' | 'CLOUDINARY_API_KEY' | 'CLOUDINARY_API_SECRET'> = [
        'CLOUDINARY_CLOUD_NAME',
        'CLOUDINARY_API_KEY',
        'CLOUDINARY_API_SECRET',
      ];

      for (const field of requiredCloudinaryFields) {
        const val = data[field];
        if (!val || val.trim().length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `FATAL CONFIGURATION ERROR: ${field} must be provided when STORAGE_DRIVER is 'cloudinary'.`,
          });
        } else if (
          isProduction &&
          (val.startsWith('your_cloudinary_') || val.startsWith('replace_with_'))
        ) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [field],
            message: `FATAL CONFIGURATION ERROR: ${field} cannot use template placeholder values in production.`,
          });
        }
      }
    }
  });

export type EnvConfig = z.infer<typeof envSchema> & {
  JWT_ACCESS_SECRET: string;
  JWT_REFRESH_SECRET: string;
  AUDIT_LOG_HMAC_SECRET: string;
};

export function validateEnv(inputEnv: Record<string, string | undefined>): EnvConfig {
  const result = envSchema.safeParse(inputEnv);
  if (!result.success) {
    const errorMessages = result.error.errors.map((e) => `[${e.path.join('.')}]: ${e.message}`).join('; ');
    throw new Error(`Environment validation failed: ${errorMessages}`);
  }
  return result.data as EnvConfig;
}

export const env: EnvConfig = validateEnv(process.env);
