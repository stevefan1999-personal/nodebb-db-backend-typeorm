module.exports = {
  moduleNameMapper: {
    '~/(.*)': '<rootDir>/src/$1',
  },
  rootDir: '.',
  setupFilesAfterEnv: ['jest-extended/all'],
  testMatch: ['<rootDir>/test/**/*test.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest'],
  },
}
