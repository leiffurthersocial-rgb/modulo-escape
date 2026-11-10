import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'tools', '.asset-cache', 'public', 'test-results', 'playwright-report'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['e2e/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
  {
    // The generator must stay pure: no rendering, physics or DOM dependencies.
    files: ['src/gen/**/*.ts', 'src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['three', 'three/*'], message: 'gen/ and core/ must not depend on three.js' },
          { group: ['@dimforge/*'], message: 'gen/ and core/ must not depend on physics' },
          { group: ['**/world/*', '**/render/*', '**/ui/*', '**/player/*', '**/input/*', '**/physics/*'], message: 'gen/ and core/ are leaf layers' },
        ],
      }],
      'no-restricted-globals': ['error', 'document', 'window', 'localStorage'],
    },
  },
);
