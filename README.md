# Custom T-Shirt Studio

কাস্টম টি-শার্ট ডিজাইন ও অর্ডার ম্যানেজমেন্ট প্ল্যাটফর্ম। কাস্টমার নিজেই ব্রাউজারে শার্ট ডিজাইন করে, অর্ডার দেয়, পেমেন্ট করে — আর প্রতিটা অর্ডার একটা Unique Order ID পায় যা দিয়ে ডিজাইন কনফার্মেশন থেকে ডেলিভারি পর্যন্ত ট্র্যাক করা যায়। অ্যাডমিন এক ড্যাশবোর্ড থেকে অর্ডার, প্রোডাকশন, পেমেন্ট ও রিপোর্ট চালায়।

**Stack:** Next.js 16 · NestJS 11 · PostgreSQL 17 + Prisma 7 · Fabric.js (2D studio) · Three.js (3D preview) · BullMQ/Redis · MinIO · Docker

## Quick start

দরকার: Node 22+, Docker Desktop চালু।

```bash
cp .env.example .env
npm install
npm run docker:up                    # Postgres + Redis + MinIO
npm run db:migrate -w @tshirt/api    # টেবিল তৈরি
npm run dev                          # api :4000 · web :3000
```

খুলুন http://localhost:3000 — API সংযুক্ত থাকলে সবুজ কার্ড দেখাবে।

## Commands

| কমান্ড | কাজ |
|---|---|
| `npm run dev` | api + web একসাথে |
| `npm run test` | সব workspace-এর টেস্ট |
| `npm run lint` | lint |
| `npm run build` | দুই app build |
| `npm run db:studio` | Prisma Studio (DB ব্রাউজার) |
| `npm run docker:up` / `docker:down` | service চালু / বন্ধ |
| `npm run docker:reset` | volume সহ মুছে নতুন করে শুরু |

## Ports

| Service | Port | নোট |
|---|---|---|
| web | 3000 | |
| api | 4000 | |
| Postgres | **5433** | 5432 নয় — host-এ আলাদা Postgres থাকলে সেটা 5432 দখল করে রাখে |
| Redis | 6379 | |
| MinIO | 9000 / 9001 | 9001 = ওয়েব কনসোল (minioadmin / minioadmin) |

> Windows-এ `.env`-এ `localhost` নয়, **`127.0.0.1`** লিখুন — localhost আগে IPv6-এ resolve হয় আর Docker-এর IPv6 forward timeout করে।

## Docs

- [docs/plans/PROGRESS.md](docs/plans/PROGRESS.md) — কোন phase কোথায়
- [docs/plans/00-master.md](docs/plans/00-master.md) — পুরো roadmap
- [CLAUDE.md](CLAUDE.md) — কনভেনশন
