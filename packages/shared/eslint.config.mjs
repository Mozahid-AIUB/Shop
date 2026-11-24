import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * `packages/shared`-এর lint।
 *
 * **কেন এটা সবচেয়ে বেশি দরকার:** এখানেই টাকার হিসাব
 * (`summarizePayments`), ঝুঁকির স্কোর (`assessFraud`) আর সব input
 * validation। এই কোড api আর web **দুই জায়গাতেই** চলে, তাই এখানকার
 * একটা ভুল দুই দিকেই ছড়ায়।
 *
 * আগে এখানে lint ছিল না — api আর web-এর ছিল, মাঝের সবচেয়ে
 * গুরুত্বপূর্ণ প্যাকেজটাই বাদ পড়েছিল।
 */
export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
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
      // CLAUDE.md-র নিয়ম — `any` দিলে টাইপ যাচাই অর্থহীন হয়ে যায়
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],

      /**
       * গুণমানের সীমা — api-র মতোই। এখানে বিশেষ করে দরকার, কারণ
       * এই কোড দুই পাশে চলে: একটা জটিল ফাংশন দুই দিকেই ভোগায়।
       */
      complexity: ['error', 12],
      'max-depth': ['error', 4],
      'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 90, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 5],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
);
