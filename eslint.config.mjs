import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Typed lint использует tsconfig каждого workspace-пакета и не проверяет generated/build output.
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/.angular/**',
      '**/generated/**',
      '**/node_modules/**',
      'eslint.config.mjs',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: ['packages/database/prisma/*.ts', 'packages/domain/src/*.spec.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Любой необработанный Promise считается ошибкой; явный void документирует fire-and-forget.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
);
