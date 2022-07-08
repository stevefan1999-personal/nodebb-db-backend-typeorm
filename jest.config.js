module.exports = {
  rootDir: '.',
  setupFilesAfterEnv: ['jest-extended/all'],
  testMatch: ['<rootDir>/test/**/*test.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest'],
  },
}
