# CLAUDE.md — প্রজেক্ট কনভেনশন

**যেকোনো পণ্যের** ই-কমার্স ও অর্ডার ম্যানেজমেন্ট প্ল্যাটফর্ম। Next.js + NestJS monorepo, রিয়েল বিজনেস — লাইভে যাবে।

**দুটো কথা মাথায় রেখে কোড লেখা হয়:**

১. **পণ্য যেকোনো কিছু** — জামাকাপড়, ইলেকট্রনিক্স, বই, খাবার, প্রসাধনী।
কোথাও "টি-শার্ট" ধরে নেওয়া চলবে না। ক্যাটাগরি, ভ্যারিয়েন্ট, অপশন,
স্পেসিফিকেশন, ওজন — সব জেনেরিক। কাস্টম ডিজাইন স্টুডিও একটা **ফিচার**,
পুরো দোকানের ভিত্তি নয়।

২. **এটা source-code product** — মালিক নিজে ব্যবহার করবে, আর অন্য
ব্যবসায়ীদের কাছেও বিক্রি করবে। প্রত্যেকে নিজের install চালাবে, তাই:
- কোনো multi-tenant `shopId` নেই
- দোকানভেদে বদলায় এমন কিছু **হার্ডকোড নয়** — ডেলিভারি চার্জ, কুপন,
  কুরিয়ারের key, ওজনের ডিফল্ট, সব অ্যাডমিন প্যানেল থেকে
- অ্যাপ যা ছাড়া চলে না তা **migration-এ** বসে, seed-এ নয় — CI seed
  চালায় না, আর যে ব্যবসায়ী শুধু `db:deploy` চালাবে সেও না

## প্রতি session-এর প্রথম কাজ

1. `docs/plans/PROGRESS.md` পড়ো — কোন phase কোথায় আছে (১৫ লাইন)।
   কাজ ধরার আগে `docs/plans/HANDOVER.md`-ও দেখে নাও — এখনকার অবস্থা,
   API-র পুরো তালিকা, আর যে ভুলগুলো আগে হয়েছে
2. পরের phase-এর sub-plan ফাইলটা পড়ো — **শুধু ওইটা**, `docs/plans/00-master.md` বা অন্য sub-plan নয়
3. কাজ শেষে `PROGRESS.md` আপডেট করো

পুরো প্ল্যান একসাথে পড়া নিষেধ — context বাঁচানোর জন্য এই কাঠামো ইচ্ছাকৃত।

## Git

- **কমিটে বা PR-এ Claude/AI-র নাম, `Co-Authored-By` trailer, বা "Generated with" লাইন লিখবে না।** Contributor শুধু MOZAHID।
- Conventional Commits: `feat(orders): add order id generator`, `fix(auth): ...`, `chore: ...`
- প্রতি phase নিজের branch-এ (`phase/01-foundation`), শেষে `main`-এ merge
- `.env` কখনো কমিট নয় — শুধু `.env.example`

## ভাষা

ইউজারের সাথে **বাংলা** (বাংলা স্ক্রিপ্টে), technical term ইংরেজিতে। কোড, কমেন্ট, কমিট মেসেজ, ডকুমেন্টেশনের হেডিং — ইংরেজিতে।

## Stack (version pinned)

| | |
|---|---|
| web | Next.js 16 (App Router) + React 19 + Tailwind 4 |
| api | NestJS 11 + Prisma 7 + PostgreSQL 17 |
| auth | নিজের JWT (access + refresh) + RBAC guard — Supabase নয় |
| canvas | Fabric.js 7 (2D studio) + Three.js (3D preview) |
| jobs | BullMQ + Redis |
| storage | MinIO (S3-compatible) |
| infra | Docker Compose — **host-এ Postgres/Redis install করবে না** |

## Structure

```
apps/api      NestJS — সব business logic, src/modules/<domain>/
apps/web      Next.js — (shop) (studio) (account) (admin) route group
packages/shared   দুই পাশে shared TS type + Zod schema
docker/       compose + Dockerfile
docs/plans/   master + sub-plan + PROGRESS
```

## Rules

- **TDD** — টেস্ট আগে, তারপর implementation
- Shared type `packages/shared`-এ, দুই জায়গায় ডুপ্লিকেট করবে না
- API-তে সব input Zod/class-validator দিয়ে validate হবে
- টাকার হিসাব **integer paisa**-তে (float নয়)
- `any` টাইপ নিষেধ
- ফাইল বড় হয়ে গেলে ভাগ করো — এক ফাইল এক দায়িত্ব

## Commands

```bash
docker compose -f docker/docker-compose.yml up -d   # Postgres + Redis + MinIO
npm run dev              # api :4000 + web :3000 একসাথে
npm run test             # সব workspace-এর টেস্ট
npm run build            # দুই app build
npm run db:migrate       # Prisma migration
npm run db:studio        # Prisma Studio
```
