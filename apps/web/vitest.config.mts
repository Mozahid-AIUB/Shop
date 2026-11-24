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

      /**
       * `@shop/shared` resolves to its TypeScript source, not its build.
       *
       * That keeps web tests honest about the types the API actually
       * sends, without a build step between changing a schema and
       * seeing the test fail.
       *
       * **It does mean the built `dist` must not be stale.** Add an
       * export to `packages/shared/src` and run the web tests before
       * rebuilding, and the module graph reaches a half-present
       * package: the failure is
       * "Cannot read properties of undefined (reading 'config')",
       * pointing at the test's own `describe` line, which looks like a
       * Testing Library or vitest problem and is neither. `npm test`
       * from the root builds shared first, so take that path rather
       * than running vitest directly after editing shared.
       */
      '@shop/shared': `${root}/../../packages/shared/src/index.ts`,
    },
  },
});
