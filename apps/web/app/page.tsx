import { HealthCard } from '@/components/health-card';
import { getHealth } from '@/lib/api';

// Phase 03-এ আসল হোমপেজ আসবে। এখন এটা শুধু প্রমাণ যে web ↔ api সংযোগ কাজ করছে।
export default async function HomePage() {
  const health = await getHealth();

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-3">
        <p className="text-sm font-medium tracking-wide text-brand-500 uppercase">Phase 01 — Foundation</p>
        <h1 className="text-4xl font-bold text-balance sm:text-5xl">Custom T-Shirt Studio</h1>
        <p className="max-w-prose text-neutral-400">
          নিজের ডিজাইনে কাস্টম টি-শার্ট। প্ল্যাটফর্মের কঙ্কাল দাঁড়িয়েছে — ডিজাইন স্টুডিও, অর্ডার
          ম্যানেজমেন্ট আর অ্যাডমিন প্যানেল পরের ধাপে আসছে।
        </p>
      </div>

      <HealthCard health={health} />
    </main>
  );
}
