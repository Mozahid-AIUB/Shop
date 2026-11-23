import * as matchers from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';

/**
 * `@testing-library/jest-dom/vitest` নিজে vitest থেকে `expect` খুঁজে নেয়।
 * Windows-এ npm workspace থেকে চালালে cwd-র drive letter ছোট হাতের হয় (`d:/`),
 * ফলে Vite vitest-এর দুটো আলাদা কপি লোড করে আর সেই খোঁজা ব্যর্থ হয়।
 * তাই matcher-গুলো এখানে নিজেরাই যোগ করা হয়, যে কপিই চলুক না কেন।
 */
expect.extend(matchers);
