import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Windows-এ npm workspace ছোট হাতের drive letter দিয়ে cwd সেট করে (`d:/…`)।
 * Vite তখন `d:/…` আর `D:/…` কে আলাদা পথ ধরে নিয়ে নিজের runtime দুবার লোড
 * করে, আর `describe` undefined হয়ে যায়। তাই drive letter বড় হাতের করে
 * সেখান থেকে vitest চালানো হয়।
 */
const webDir = resolve(import.meta.dirname, '..', 'apps', 'web');
const cwd = webDir.replace(/^([a-z]):/, (_, drive) => `${drive.toUpperCase()}:`);

execSync('npx vitest run', { cwd, stdio: 'inherit' });
