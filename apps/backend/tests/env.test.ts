import { validateEnv, KNOWN_INSECURE_SECRETS } from '../src/config/env.js';

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
