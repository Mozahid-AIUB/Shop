import type { HealthResponse } from '@tshirt/shared';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000';

/**
 * API বন্ধ থাকলে বা 5xx দিলে null — পেজ ক্র্যাশ করবে না।
 * ব্যর্থতা এখানেই থামে যাতে caller-কে try/catch করতে না হয়।
 */
export async function getHealth(): Promise<HealthResponse | null> {
  try {
    const response = await fetch(`${API_URL}/health`, { cache: 'no-store' });
    if (!response.ok && response.status !== 503) return null;
    return (await response.json()) as HealthResponse;
  } catch {
    return null;
  }
}
