/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts', '**/*.test.tsx'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          target: 'es2020',
          esModuleInterop: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@enterprise-ai/shared-types$': '<rootDir>/../../packages/shared-types/src/index.ts',
    '^lucide-react$': '<rootDir>/../../node_modules/lucide-react/dist/cjs/lucide-react.js',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testTimeout: 15000,
  verbose: true,
};
