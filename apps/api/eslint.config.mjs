import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      /**
       * কোডের গুণমানের সীমা।
       *
       * CLAUDE.md বলে "ফাইল বড় হয়ে গেলে ভাগ করো" — কিন্তু কেউ না
       * মাপলে সেটা শুধু ইচ্ছা, নিয়ম নয়। এই সীমাগুলো এখনকার কোডের
       * একটু উপরে বসানো: আজকের কোড পাস করে, কিন্তু অবনতি হলে
       * সাথে সাথে ধরা পড়ে।
       *
       * `skipComments` — এই প্রজেক্টে কমেন্টে অনেক ব্যাখ্যা থাকে
       * (কেন এভাবে করা হলো)। সেটা কোডের জটিলতা নয়, তাই গোনা হয় না।
       */

      // শর্তের জট। ১০-এর বেশি মানে ফাংশনটা একাধিক কাজ করছে
      complexity: ['error', 12],

      // if-এর ভেতরে if-এর ভেতরে if — ৪ স্তরের পরে পড়া কঠিন হয়ে যায়
      'max-depth': ['error', 4],

      // এক ফাইল এক দায়িত্ব — বড় হলে ভাগ করার ইঙ্গিত
      'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],

      // লম্বা ফাংশন মানে সাধারণত কয়েকটা ছোট ফাংশন একসাথে লেখা
      'max-lines-per-function': ['error', { max: 90, skipBlankLines: true, skipComments: true }],

      // ৫টার বেশি প্যারামিটার মানে একটা object হওয়া উচিত ছিল
      'max-params': ['error', 5],

      // একই জিনিস দুভাবে লেখা — পরে একটা বদলে অন্যটা ভুলে যাওয়া হয়
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    /**
     * টেস্টে সীমা ঢিলে। একটা e2e suite স্বভাবতই লম্বা হয় —
     * অনেকগুলো পরিস্থিতি একসাথে যাচাই করে, আর `describe` block
     * একটা বড় ফাংশন হিসেবে গোনা হয়।
     */
    files: ['test/**/*.ts'],
    rules: {
      'max-lines': 'off',
      'max-lines-per-function': 'off',
    },
  },
);
