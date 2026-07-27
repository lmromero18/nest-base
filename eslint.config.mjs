// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: [
      'src/common/services/base.service.ts',
      'src/common/query/query-string-parser.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '../../modules/**',
                '../../../modules/**',
                '../../config/**',
                '../../../config/**',
                '../guards/**',
                '../decorators/**',
                '../context/request-context.interceptor',
                '../interfaces/**',
                '../http/**',
                '../logger/**',
                '../filters/**',
                '../responses/**',
                '../controller/**',
              ],
              message:
                'Core code must not depend on application modules, policy, or transport/infrastructure adapters.',
            },
            {
              group: [
                '@nestjs/core',
                '@nestjs/config',
                '@nestjs/jwt',
                '@nestjs/platform-fastify',
                '@nestjs/swagger',
                'fastify',
                'nodemailer',
              ],
              message:
                'Core code must not depend on transport, authentication, Swagger, or outbound integration packages.',
            },
          ],
        },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      // La librería base coerce query params y valores de log (unknown → string) a propósito
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      'prettier/prettier': ['error', { endOfLine: 'auto' }],
    },
  },
);
