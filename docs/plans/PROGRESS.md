# PROGRESS — কোন phase কোথায়

> প্রতি session-এ **এই ফাইলটা আগে পড়ো**, তারপর শুধু পরের phase-এর sub-plan ফাইল।

| # | Phase | Status | Sub-plan |
|---|---|---|---|
| 01 | Foundation (monorepo, Prisma, health) | ✅ শেষ | `01-foundation.md` |
| 02 | Auth + RBAC | ✅ শেষ (backend) | `02-auth-rbac.md` |
| 03 | Catalog + Inventory | ⬜ পরের কাজ | — |
| 04 | Cart + Checkout + Order ID | ⬜ বাকি | — |
| 05 | Payments (COD + manual, gateway পরে) | ⬜ বাকি | — |
| 06 | Order Lifecycle + Tracking | ⬜ বাকি | — |
| 07 | Admin Panel | ⬜ বাকি | — |
| 08 | Notifications (BullMQ) | ⬜ বাকি | — |
| 09 | Reports + Analytics | ⬜ বাকি | — |
| 10 | Courier (Steadfast/Pathao/RedX) | ⬜ বাকি | — |
| 11 | Fraud Guard (COD risk) | ⬜ বাকি | — |
| 12 | Tracking (Meta Pixel + CAPI) | ⬜ বাকি | — |
| 13 | Hardening + Deploy | ⬜ বাকি | — |

**এখন কোথায়:** Phase 02-এর backend শেষ — register/login/refresh/logout/me কাজ করে, ২৬টা টেস্ট সবুজ, lint পরিষ্কার, Super Admin seed হয়েছে। Next middleware (2.10) বাকি।
**পরের কাজ:** Phase 03 — Catalog + Inventory। সব রকম প্রোডাক্ট সাপোর্ট করবে এমন নমনীয় variant + attribute schema।
**Blocker:** নেই।

**Push করার আগে `/ship-review` চালাও** — `.claude/skills/ship-review/`। lint+test+build চালায়, diff-এ secret খোঁজে, এই স্ট্যাকের security ও production-readiness checklist ধরে রিভিউ করে, Blocker/High ফিক্স করে, তারপর commit+push।

## এই মেশিনের environment নোট (হোঁচট খাওয়ার আগে পড়ো)

- **Docker নেই এই মেশিনে** — PostgreSQL 17 native install (winget), port **5433**. `docker compose` command-গুলো এখানে চলবে না
- Redis আর MinIO এখনও নেই — Phase 04 (upload) আর Phase 10 (BullMQ)-এ লাগবে, তখন ব্যবস্থা হবে
- `.env`-এ **`127.0.0.1`** লেখো, `localhost` নয় — Windows-এ localhost আগে IPv6-এ যায় আর Docker-এর IPv6 forward timeout করে
- Prisma 7-এ connection URL `prisma.config.ts`-এ, `schema.prisma`-তে নয়; runtime client `@prisma/adapter-pg` দিয়ে চলে
- API build output nested: `dist/apps/api/src/main.js` (packages/shared বাইরে থাকায় tsc rootDir উপরে তোলে)
