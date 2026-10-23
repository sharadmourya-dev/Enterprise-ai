const baseConfig = require('./jest.config.base.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  displayName: 'unit',
  // Pure unit tests: absolutely NO database connection, no dropDatabase(), and no external service lifecycle
  setupFilesAfterEnv: [],
  testMatch: [
    '<rootDir>/tests/env.test.ts',
    '<rootDir>/tests/storage-path.test.ts',
    '<rootDir>/tests/storage-driver.test.ts',
    '<rootDir>/tests/cors.test.ts',
    '<rootDir>/tests/mongo-safety.test.ts',
    '<rootDir>/tests/admin-promote.test.ts',
    '<rootDir>/tests/llm.test.ts',
    '<rootDir>/tests/llm-fallback.test.ts',
  ],
};
