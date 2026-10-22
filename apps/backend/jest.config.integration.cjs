const baseConfig = require('./jest.config.base.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...baseConfig,
  displayName: 'integration',
  // Integration tests: explicitly opt into managed MongoDB/Redis test connection lifecycle
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
};
