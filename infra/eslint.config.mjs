// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['cdk.out/', 'node_modules/', 'jest.config.js', 'eslint.config.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // CDK constructs are instantiated for their side effects (`new Stack(...)`).
      'no-new': 'off',
    },
  },
);
