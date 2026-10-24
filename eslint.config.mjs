import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTypescript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier/flat';

const sourceRestrictions = [
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message: 'Read environment variables through config/env.ts.',
  },
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
  { files: ['src/config/**'], rules: { 'no-restricted-syntax': 'off' } },
  {
    files: [
      'src/app/**/*.{ts,tsx}',
      'src/components/{fan,artist,admin}/**/*.{ts,tsx}',
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
        { patterns: ['**/server/**', '**/types/database*'] },
      ],
      'no-restricted-globals': ['error', 'fetch'],
    },
  },
]);
