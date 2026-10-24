import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

const environmentRestrictions = [
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message:
      'Read environment variables through config/env.ts or config/env.server.ts.',
  },
  {
    selector: "MemberExpression[object.name='process'][property.value='env']",
    message:
      'Read environment variables through the central environment modules.',
  },
  {
    selector: "VariableDeclarator[init.name='process']",
    message:
      'Do not alias or destructure process outside the environment modules.',
  },
];

const sourceRestrictions = [
  ...environmentRestrictions,
  {
    selector: 'JSXText[value=/[가-힣]/]',
    message: 'Put user-visible copy in messages/ko.json.',
  },
  {
    selector:
      'Literal[value=/^\\/(artists|board|schedules|me|admin|artist|api)/]',
    message: 'Use config/routes.ts for route paths.',
  },
];

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  prettier,
  globalIgnores([
    '.next/**',
    'coverage/**',
    'playwright-report/**',
    'test-results/**',
    'next-env.d.ts',
    'public/sw.js',
    'public/sw.js.map',
    'public/offline.html',
  ]),
  {
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      'no-console': 'error',
      'no-restricted-syntax': ['error', ...sourceRestrictions],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/config/**'],
    rules: {
      'no-magic-numbers': [
        'error',
        {
          ignore: [0, 1, -1],
          ignoreArrayIndexes: true,
          enforceConst: true,
          detectObjects: false,
        },
      ],
    },
  },
  {
    files: ['src/config/**'],
    rules: { 'no-restricted-syntax': ['error', ...environmentRestrictions] },
  },
  {
    files: ['src/config/env.ts', 'src/config/env.server.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['src/lib/**/*.{ts,tsx}', 'src/config/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['**/server/**', 'next', 'next/*', 'node:*'] },
      ],
      'no-restricted-globals': ['error', 'fetch'],
    },
  },
  {
    files: ['src/lib/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '**/server/**',
            '**/env.server',
            '**/env.server.*',
            'next',
            'next/*',
            'node:*',
          ],
        },
      ],
    },
  },
  {
    files: ['src/server/logging/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: [
      'src/app/**/*.{ts,tsx}',
      'src/components/{fan,artist,artists,artist-compose,artist-compose-menu,artist-dispatch,admin,onboarding,checkout,subscription}/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: ['**/server/adapters/**', '**/server/db/**'] },
      ],
      'no-restricted-syntax': [
        'error',
        ...sourceRestrictions,
        {
          selector: 'JSXOpeningElement[name.name=/^(button|a|input)$/]',
          message: 'Use accessible components/ui primitives.',
        },
      ],
    },
  },
  {
    files: ['src/server/services/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': ['error', { patterns: ['next', 'next/*'] }],
      'no-restricted-globals': ['error', 'fetch'],
    },
  },
  {
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '**/server/**',
            '**/env.server',
            '**/env.server.*',
            '**/types/database*',
          ],
        },
      ],
      'no-restricted-globals': ['error', 'fetch'],
    },
  },
  {
    files: ['src/client/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            '**/server/**',
            '**/env.server',
            '**/env.server.*',
            '**/types/database*',
          ],
        },
      ],
    },
  },
]);
