module.exports = {
  moduleNameMapper: {
    '~/(.*)': '<rootDir>/src/$1',
  },
  rootDir: '.',
  setupFilesAfterEnv: [
    'jest-extended/all',
    '@testdeck/di-typedi',
    '<rootDir>/test/setup.ts',
  ],
  testEnvironment: 'node',
  testMatch: ['<rootDir>/test/**/*test.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest'],
  },
}
