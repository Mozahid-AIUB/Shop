# PROGRESS — কোন phase কোথায়

> প্রতি session-এ **এই ফাইলটা আগে পড়ো**, তারপর শুধু পরের phase-এর sub-plan ফাইল।

| # | Phase | Status | Sub-plan |
|---|---|---|---|
| 01 | Foundation (monorepo, Docker, Prisma, health) | ✅ শেষ | `01-foundation.md` |
| 02 | Auth + RBAC | ⬜ পরের কাজ | (phase শুরুর সময় লেখা হবে) |
| 03 | Catalog + Inventory | ⬜ বাকি | — |
| 04 | Design Studio (Fabric.js) | ⬜ বাকি | — |
| 05 | 3D Preview (Three.js) | ⬜ বাকি | — |
| 06 | Cart + Checkout + Order ID | ⬜ বাকি | — |
| 07 | Payments + Invoice | ⬜ বাকি | — |
| 08 | Order Lifecycle + Tracking | ⬜ বাকি | — |
| 09 | Admin + Production Panel | ⬜ বাকি | — |
| 10 | Notifications (BullMQ) | ⬜ বাকি | — |
| 11 | Reports + Analytics | ⬜ বাকি | — |
| 12 | Hardening + Deploy | ⬜ বাকি | — |

**এখন কোথায়:** Phase 01 শেষ ও যাচাই হয়েছে — lint পরিষ্কার, টেস্ট ৫/৫ (api 2, web 3), দুই app build হয়, লাইভ `/health` DB-up-এ 200 ও DB-down-এ 503 দেয়।
**পরের কাজ:** `02-auth-rbac.md` লিখে তারপর execute।
**Blocker:** নেই।

## এই মেশিনের environment নোট (হোঁচট খাওয়ার আগে পড়ো)

- **Postgres port 5433**, 5432 নয় — host-এ `postgresql-x64-16` service চলে যেটা 5432 দখল করে রাখে
- `.env`-এ **`127.0.0.1`** লেখো, `localhost` নয় — Windows-এ localhost আগে IPv6-এ যায় আর Docker-এর IPv6 forward timeout করে
- Prisma 7-এ connection URL `prisma.config.ts`-এ, `schema.prisma`-তে নয়; runtime client `@prisma/adapter-pg` দিয়ে চলে
- API build output nested: `dist/apps/api/src/main.js` (packages/shared বাইরে থাকায় tsc rootDir উপরে তোলে)
