import { validateEnv, KNOWN_INSECURE_SECRETS, booleanEnv } from '../src/config/env.js';

describe('Production Secret Validation & Environment Safeguards', () => {
  const baseValidProdEnv: Record<string, string> = {
    NODE_ENV: 'production',
    PORT: '5000',
    FRONTEND_URL: 'https://copilot.enterprise.com',
    API_BASE_URL: 'https://api.copilot.enterprise.com/api/v1',
    MONGODB_URI: 'mongodb://mongodb:27017/enterprise_ai?replicaSet=rs0',
    REDIS_HOST: 'redis',
    REDIS_PORT: '6379',
    QDRANT_URL: 'http://qdrant:6333',
    JWT_ACCESS_SECRET: 'StrongProductionAccessSecretWithAtLeast32Chars123456789!',
    JWT_REFRESH_SECRET: 'StrongProductionRefreshSecretWithAtLeast32Chars123456789!',
    AUDIT_LOG_HMAC_SECRET: 'StrongProductionAuditHmacSecretWithAtLeast32Chars123456789!',
  };

  it('should successfully validate strong, explicit production configuration', () => {
    const config = validateEnv(baseValidProdEnv);
    expect(config.NODE_ENV).toBe('production');
    expect(config.JWT_ACCESS_SECRET).toBe(baseValidProdEnv.JWT_ACCESS_SECRET);
  });

  it('should reject production startup if JWT_ACCESS_SECRET is missing', () => {
    const invalidEnv = { ...baseValidProdEnv };
    delete invalidEnv.JWT_ACCESS_SECRET;

    expect(() => validateEnv(invalidEnv)).toThrow(/must be explicitly provided in production/);
  });

  it('should reject production startup if secret is shorter than 32 characters', () => {
    const invalidEnv = {
      ...baseValidProdEnv,
      JWT_ACCESS_SECRET: 'TooShortSecret123', // 17 chars
    };

    expect(() => validateEnv(invalidEnv)).toThrow(/must be at least 32 characters long in production/);
  });

  it('should reject production startup if known development default is used', () => {
    for (const devSecret of KNOWN_INSECURE_SECRETS) {
      const invalidEnv = {
        ...baseValidProdEnv,
        JWT_ACCESS_SECRET: devSecret,
      };

      expect(() => validateEnv(invalidEnv)).toThrow(/cannot use known development default/);
    }
  });

  it('should reject production startup if template placeholder (replace_with_...) is used', () => {
    const invalidEnv = {
      ...baseValidProdEnv,
      AUDIT_LOG_HMAC_SECRET: 'replace_with_strong_256_bit_random_secret_for_audit_logs_custom',
    };

    expect(() => validateEnv(invalidEnv)).toThrow(/cannot use known development default or template placeholder/);
  });

  it('should allow omitted secrets in development and test modes with safe defaults', () => {
    const devEnv = {
      NODE_ENV: 'development',
    };

    const config = validateEnv(devEnv);
    expect(config.NODE_ENV).toBe('development');
    expect(config.JWT_ACCESS_SECRET).toBeDefined();
    expect(config.JWT_ACCESS_SECRET.length).toBeGreaterThan(16);
  });
});

describe('Boolean Environment Variable Parser (booleanEnv)', () => {
  it('parses "true" and "1" as boolean true', () => {
    expect(booleanEnv(false).parse('true')).toBe(true);
    expect(booleanEnv(false).parse('1')).toBe(true);
    expect(booleanEnv(true).parse('true')).toBe(true);
    expect(booleanEnv(true).parse('1')).toBe(true);
  });

  it('parses "false" and "0" as boolean false', () => {
    expect(booleanEnv(true).parse('false')).toBe(false);
    expect(booleanEnv(true).parse('0')).toBe(false);
    expect(booleanEnv(false).parse('false')).toBe(false);
    expect(booleanEnv(false).parse('0')).toBe(false);
  });

  it('handles case-insensitivity and whitespace properly', () => {
    expect(booleanEnv(false).parse('  TRUE  ')).toBe(true);
    expect(booleanEnv(false).parse('True')).toBe(true);
    expect(booleanEnv(false).parse('  1  ')).toBe(true);
    expect(booleanEnv(true).parse('  FALSE  ')).toBe(false);
    expect(booleanEnv(true).parse('False')).toBe(false);
    expect(booleanEnv(true).parse('  0  ')).toBe(false);
  });

  it('preserves default value when input is undefined or empty string', () => {
    expect(booleanEnv(true).parse(undefined)).toBe(true);
    expect(booleanEnv(false).parse(undefined)).toBe(false);
    expect(booleanEnv(true).parse('')).toBe(true);
    expect(booleanEnv(false).parse('')).toBe(false);
  });

  it('preserves native boolean literal values', () => {
    expect(booleanEnv(false).parse(true)).toBe(true);
    expect(booleanEnv(true).parse(false)).toBe(false);
  });

  it('rejects unsupported boolean strings with a clear validation error', () => {
    const parser = booleanEnv(true);
    expect(() => parser.parse('yes')).toThrow(/Must be a valid boolean representation/);
    expect(() => parser.parse('no')).toThrow(/Must be a valid boolean representation/);
    expect(() => parser.parse('enabled')).toThrow(/Must be a valid boolean representation/);
    expect(() => parser.parse('disabled')).toThrow(/Must be a valid boolean representation/);
    expect(() => parser.parse('2')).toThrow(/Must be a valid boolean representation/);
    expect(() => parser.parse('on')).toThrow(/Must be a valid boolean representation/);
  });
});

describe('Feature Flag Schema Bindings (REDIS_TLS, RAG_CACHE_ENABLED, RATE_LIMIT_ENABLED)', () => {
  const minimalDevEnv: Record<string, string> = {
    NODE_ENV: 'development',
  };

  it('preserves default values when feature flags are omitted', () => {
    const config = validateEnv(minimalDevEnv);
    expect(config.REDIS_TLS).toBe(false);
    expect(config.RAG_CACHE_ENABLED).toBe(true);
    expect(config.RATE_LIMIT_ENABLED).toBe(true);
  });

  it('correctly disables flags when explicitly set to "false" or "0"', () => {
    const config = validateEnv({
      ...minimalDevEnv,
      RAG_CACHE_ENABLED: 'false',
      RATE_LIMIT_ENABLED: '0',
    });
    expect(config.RAG_CACHE_ENABLED).toBe(false);
    expect(config.RATE_LIMIT_ENABLED).toBe(false);
  });

  it('correctly enables flags when explicitly set to "true" or "1"', () => {
    const config = validateEnv({
      ...minimalDevEnv,
      REDIS_TLS: 'true',
      RAG_CACHE_ENABLED: '1',
      RATE_LIMIT_ENABLED: 'true',
    });
    expect(config.REDIS_TLS).toBe(true);
    expect(config.RAG_CACHE_ENABLED).toBe(true);
    expect(config.RATE_LIMIT_ENABLED).toBe(true);
  });

  it('rejects startup when invalid string is passed to feature flags', () => {
    expect(() =>
      validateEnv({
        ...minimalDevEnv,
        RAG_CACHE_ENABLED: 'invalid_boolean',
      })
    ).toThrow(/Must be a valid boolean representation/);

    expect(() =>
      validateEnv({
        ...minimalDevEnv,
        RATE_LIMIT_ENABLED: 'not_a_bool',
      })
    ).toThrow(/Must be a valid boolean representation/);

    expect(() =>
      validateEnv({
        ...minimalDevEnv,
        REDIS_TLS: 'enabled',
      })
    ).toThrow(/Must be a valid boolean representation/);
  });
});

describe('Storage Driver & Cloudinary Configuration Validation', () => {
  const minimalDevEnv: Record<string, string> = {
    NODE_ENV: 'development',
  };

  it('defaults to STORAGE_DRIVER="local" and allows omitted Cloudinary credentials', () => {
    const config = validateEnv(minimalDevEnv);
    expect(config.STORAGE_DRIVER).toBe('local');
    expect(config.MAX_CLOUDINARY_FILE_SIZE_BYTES).toBe(10485760);
    expect(config.MAX_FILE_SIZE_BYTES).toBe(52428800);
  });

  it('rejects startup if STORAGE_DRIVER is "cloudinary" but credentials are missing', () => {
    expect(() =>
      validateEnv({
        ...minimalDevEnv,
        STORAGE_DRIVER: 'cloudinary',
      })
    ).toThrow(/CLOUDINARY_CLOUD_NAME must be provided/);

    expect(() =>
      validateEnv({
        ...minimalDevEnv,
        STORAGE_DRIVER: 'cloudinary',
        CLOUDINARY_CLOUD_NAME: 'my-cloud',
      })
    ).toThrow(/CLOUDINARY_API_KEY must be provided/);

    expect(() =>
      validateEnv({
        ...minimalDevEnv,
        STORAGE_DRIVER: 'cloudinary',
        CLOUDINARY_CLOUD_NAME: 'my-cloud',
        CLOUDINARY_API_KEY: '123456789',
      })
    ).toThrow(/CLOUDINARY_API_SECRET must be provided/);
  });

  it('accepts valid Cloudinary credentials when STORAGE_DRIVER is "cloudinary"', () => {
    const config = validateEnv({
      ...minimalDevEnv,
      STORAGE_DRIVER: 'cloudinary',
      CLOUDINARY_CLOUD_NAME: 'my-cloud',
      CLOUDINARY_API_KEY: '123456789',
      CLOUDINARY_API_SECRET: 'secret_key_123',
    });

    expect(config.STORAGE_DRIVER).toBe('cloudinary');
    expect(config.CLOUDINARY_CLOUD_NAME).toBe('my-cloud');
    expect(config.CLOUDINARY_API_KEY).toBe('123456789');
    expect(config.CLOUDINARY_API_SECRET).toBe('secret_key_123');
  });

  it('rejects template placeholders in production when STORAGE_DRIVER is "cloudinary"', () => {
    const prodEnv: Record<string, string> = {
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'StrongProductionAccessSecretWithAtLeast32Chars123456789!',
      JWT_REFRESH_SECRET: 'StrongProductionRefreshSecretWithAtLeast32Chars123456789!',
      AUDIT_LOG_HMAC_SECRET: 'StrongProductionAuditHmacSecretWithAtLeast32Chars123456789!',
      STORAGE_DRIVER: 'cloudinary',
      CLOUDINARY_CLOUD_NAME: 'your_cloudinary_cloud_name',
      CLOUDINARY_API_KEY: '123456789',
      CLOUDINARY_API_SECRET: 'secret_123',
    };

    expect(() => validateEnv(prodEnv)).toThrow(/cannot use template placeholder values in production/);
  });
});
