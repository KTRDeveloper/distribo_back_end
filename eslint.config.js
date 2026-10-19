import js from '@eslint/js';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettier from 'eslint-config-prettier';
import security from 'eslint-plugin-security';

export default [
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      'coverage/**',
      '**/*.config.ts',
      '**/*.config.js',
      'tests/fixtures/**',
      // Scripts a test writes and deletes while it runs (production-gate):
      // with test files in parallel, lint could list one and fail to read it.
      'tests/**/__*.mjs',
    ],
  },
  js.configs.recommended,
  security.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: { project: './tsconfig.eslint.json' },
    },
    plugins: { '@typescript-eslint': tsPlugin },
    rules: {
      ...tsPlugin.configs['eslint-recommended'].overrides[0].rules,
      ...tsPlugin.configs.recommended.rules,
      ...tsPlugin.configs['recommended-requiring-type-checking'].rules,
      ...prettier.rules,
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'security/detect-eval-with-expression': 'error',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
];
