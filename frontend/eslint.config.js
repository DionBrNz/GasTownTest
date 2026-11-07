// @ts-check
import eslint from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'dev/', 'eslint.config.js'] },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  reactHooks.configs.flat.recommended,
  jsxA11y.flatConfigs.strict,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The CloudFront CSP has no 'unsafe-inline': keep markup and styles in files.
      'no-restricted-syntax': [
        'error',
        {
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'dangerouslySetInnerHTML is not allowed.',
        },
        {
          selector: "JSXAttribute[name.name='style']",
          message: 'Inline styles break the strict CSP. Use a class in styles.css.',
        },
      ],
    },
  },
);
