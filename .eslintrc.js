module.exports = {
  extends: [
    'eslint:recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
    'plugin:node/recommended',
  ],
  overrides: [
    {
      // enable the rule specifically for TypeScript files
      files: ['*.ts', '*.mts', '*.cts', '*.tsx'],
      rules: {
        '@typescript-eslint/explicit-function-return-type': [
          'error',
          {
            allowConciseArrowFunctionExpressionsStartingWithVoid: false,
            allowDirectConstAssertionInArrowFunctions: true,
            allowExpressions: true,
            allowHigherOrderFunctions: true,
            allowTypedFunctionExpressions: true,
          },
        ],
        '@typescript-eslint/no-explicit-any': 'off',
        'import/no-unresolved': 'error',
        'node/no-missing-import': 'off',
      },
    },
  ],
  parserOptions: {
    ecmaVersion: 2022,
  },
  plugins: ['sort-keys'],
  root: true,
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    'import/order': [
      'error',
      {
        alphabetize: {
          caseInsensitive: true,
          order: 'asc',
        },
        groups: [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index',
          'object',
          'type',
        ],
        'newlines-between': 'always',
      },
    ],
    'node/no-missing-import': [
      'warn',
      {
        tryExtensions: [
          '.cts',
          '.js',
          '.json',
          '.jsx',
          '.mts',
          '.node',
          '.ts',
          '.tsx',
        ],
      },
    ],
    'node/no-unpublished-import': 'warn',
    'node/no-unsupported-features/es-syntax': 'off',
    'object-shorthand': ['warn'],
    'sort-keys/sort-keys-fix': [
      'warn',
      'asc',
      { caseSensitive: true, minKeys: 2, natural: false },
    ],
    'sort-vars': ['warn', { ignoreCase: true }],
  },
  settings: { 'import/resolver': { typescript: { alwaysTryTypes: true } } },
}
