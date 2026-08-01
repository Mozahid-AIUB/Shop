/** `GET /health` — API ও web দুই পাশেই এই contract ব্যবহার হয়। */
export interface HealthResponse {
  status: 'ok' | 'error';
  db: 'up' | 'down';
  /** process uptime in seconds */
  uptime: number;
  /** ISO 8601 */
  timestamp: string;
}
