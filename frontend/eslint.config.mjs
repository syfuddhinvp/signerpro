/**
 * Flat config. CI ran a warn-and-skip lint step because no configuration
 * existed (COMPLETION_PLAN.md W19); with this file present the step becomes a
 * real gate.
 *
 * `next/core-web-vitals` is the baseline. The rules relaxed below are relaxed
 * deliberately and each for a stated reason -- an ignore that nobody can
 * justify later is worse than no lint at all.
 */
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [
  {
    ignores: [
      '.next/**',
      'coverage/**',
      'node_modules/**',
      'next-env.d.ts',
      'public/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // `next/typescript` bans `any` outright. There are ~50 in this codebase,
      // almost all at genuine boundaries -- JSON coming off the wire, the
      // adapters that narrow it, and generic style helpers. Rewriting them is
      // a real refactor with regression risk and no correctness benefit, and
      // this gate exists to catch bugs, not to schedule one. Kept visible as a
      // warning so new ones are still argued for rather than waved through.
      '@typescript-eslint/no-explicit-any': 'warn',
      // The codebase styles with inline `CSSProperties` objects rather than
      // Tailwind classes (see globals.css on why `@tailwind base` is omitted),
      // so `<img>` sizing is handled there, not by next/image.
      '@next/next/no-img-element': 'off',
      // Unused args are meaningful in this codebase's handler signatures;
      // require the underscore convention instead of banning them.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
];

export default config;
