import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * Windows drive letters must be normalised, or nothing here works.
 *
 * Run as `npm run test -w @shop/web`, npm hands the child process a cwd
 * whose drive letter is **lower case** (`d:\...`); run as `npx vitest`
 * from this folder, it is **upper case** (`D:\...`). Vite keys its
 * module graph by path string, so the two spellings are two different
 * modules — and a package reached by both spellings gets loaded twice.
 *
 * For a package whose chunks import each other circularly, like `zod`,
 * one of those copies resolves to `undefined` and the first schema call
 * throws "Cannot read properties of undefined (reading 'config')". The
 * stack blames the test's own `describe` line, and every import chain
 * that reaches zod fails the same way — `@shop/shared` among them —
 * which makes it look like a problem with whatever was imported last.
 *
 * It also looks intermittent: the same code passes from one shell and
 * fails from another, so a "fix" verified once appears to work and then
 * comes back. `vitest.setup.ts` has the same note for vitest's own copy
 * of `expect`, which is the first place this bit.
 *
 * `import.meta.dirname` is the spelling of the moment, so upper-casing
 * the drive letter gives one canonical root whichever way tests start.
 */
const root = import.meta.dirname.replace(/^([a-z]):/, (_match, drive: string) =>
  `${drive.toUpperCase()}:`,
);

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
    },
  },
});
