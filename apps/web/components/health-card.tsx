import type { HealthResponse } from '@tshirt/shared';

type Tone = 'ok' | 'warn' | 'down';

const TONE_CLASSES: Record<Tone, string> = {
  ok: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  down: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
};

const DOT_CLASSES: Record<Tone, string> = {
  ok: 'bg-emerald-400',
  warn: 'bg-amber-400',
  down: 'bg-rose-400',
};

function describe(health: HealthResponse | null): { tone: Tone; label: string } {
  if (health === null) return { tone: 'down', label: 'API unreachable' };
  if (health.status === 'ok') return { tone: 'ok', label: 'API connected' };
  return { tone: 'warn', label: 'API degraded' };
}

export function HealthCard({ health }: { health: HealthResponse | null }) {
  const { tone, label } = describe(health);

  return (
    <div
      role="status"
      className={`flex w-full max-w-sm flex-col gap-2 rounded-xl border px-5 py-4 ${TONE_CLASSES[tone]}`}
    >
      <div className="flex items-center gap-2 font-medium">
        <span className={`size-2 rounded-full ${DOT_CLASSES[tone]}`} aria-hidden="true" />
        {label}
      </div>

      {health !== null && (
        <div className="text-sm text-white/60">
          <p>Database: {health.db}</p>
          <p>Uptime: {Math.round(health.uptime)}s</p>
        </div>
      )}
    </div>
  );
}
