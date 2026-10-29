module.exports = {
  roots: ['<rootDir>/apps', '<rootDir>/packages'],
  testEnvironment: 'node',
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@c48/technical$': '<rootDir>/packages/technical/src/index.ts',
    '^@c48/technical/(.*)$': '<rootDir>/packages/technical/src/$1',
    '^@c48/identity-contracts/(.*)$': '<rootDir>/packages/identity-contracts/src/$1',
  },
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: '<rootDir>/tsconfig.test.json' }],
  },
  collectCoverageFrom: ['apps/**/*.ts', 'packages/**/*.ts'],
};
