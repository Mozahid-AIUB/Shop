import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  root,
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['**/*.test.{ts,tsx}'],
  },
  resolve: {
    alias: {
      '@': root,
      '@shop/shared': `${root}/../../packages/shared/src/index.ts`,
      /**
       * `@testing-library/react` CJS, আর সে `require('@testing-library/dom')`
       * করে। Vite ওই package-এর `module` মাঠ দেখে ESM build ধরিয়ে দেয়,
       * যার namespace object-এ named export গুলো CJS-র মতো বসে না — তাই
       * `getConfig` undefined হয়ে `reading 'config'` error দেয়।
       * CJS build-টা স্পষ্ট করে দেখিয়ে দিলে দুই পাশে একই কপি থাকে।
       */
      '@testing-library/dom': `${root}/../../node_modules/@testing-library/dom/dist/index.js`,
    },
  },
});
