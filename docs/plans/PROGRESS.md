# PROGRESS — কোন phase কোথায়

> প্রতি session-এ **এই ফাইলটা আগে পড়ো**, তারপর শুধু পরের phase-এর sub-plan ফাইল।

| # | Phase | Status | Sub-plan |
|---|---|---|---|
| 01 | Foundation (monorepo, Prisma, health) | ✅ শেষ | `01-foundation.md` |
| 02 | Auth + RBAC | ✅ শেষ (backend) | `02-auth-rbac.md` |
| 03 | Catalog + Inventory | ✅ শেষ (backend) | `03-catalog.md` |
| 04 | Cart + Checkout + Order ID | 🔄 চলছে | `04-cart-checkout.md` |
| 05 | Payments (COD + manual, gateway পরে) | ⬜ বাকি | — |
| 06 | Order Lifecycle + Tracking | ⬜ বাকি | — |
| 07 | Admin Panel | ⬜ বাকি | — |
| 08 | Notifications (BullMQ) | ⬜ বাকি | — |
| 09 | Reports + Analytics | ⬜ বাকি | — |
| 10 | Courier (Steadfast/Pathao/RedX) | ⬜ বাকি | — |
| 11 | Fraud Guard (COD risk) | ⬜ বাকি | — |
| 12 | Tracking (Meta Pixel + CAPI) | ⬜ বাকি | — |
| 13 | Hardening + Deploy | ⬜ বাকি | — |

**এখন কোথায়:** Phase 02-03 `main`-এ merge হয়েছে। Phase 04 চলছে `phase/04-cart-checkout`
branch-এ — schema + migration + `OrderNumberService` + order number helper ও তার টেস্ট হয়ে গেছে
(৫১টা API টেস্ট + ৩টা web টেস্ট সবুজ)।
**পরের কাজ:** 4.4 — চেকআউটের টেস্ট আগে: দাম সার্ভারে হিসাব হয়, স্টক কমে, oversell আটকায়।
তারপর `CartService` → `AddressService` → `OrdersService`।
**Blocker:** নেই।

**Push করার আগে `/ship-review` চালাও** — `.claude/skills/ship-review/`। lint+test+build চালায়, diff-এ secret খোঁজে, এই স্ট্যাকের security ও production-readiness checklist ধরে রিভিউ করে, Blocker/High ফিক্স করে, তারপর commit+push।

## এই মেশিনের environment নোট (হোঁচট খাওয়ার আগে পড়ো)

- **Docker নেই এই মেশিনে** — PostgreSQL 17 native install (winget), port **5433**. `docker compose` command-গুলো এখানে চলবে না
- Redis আর MinIO এখনও নেই — Phase 04 (upload) আর Phase 10 (BullMQ)-এ লাগবে, তখন ব্যবস্থা হবে
- `.env`-এ **`127.0.0.1`** লেখো, `localhost` নয় — Windows-এ localhost আগে IPv6-এ যায় আর Docker-এর IPv6 forward timeout করে
- Prisma 7-এ connection URL `prisma.config.ts`-এ, `schema.prisma`-তে নয়; runtime client `@prisma/adapter-pg` দিয়ে চলে
- API build output nested: `dist/apps/api/src/main.js` (packages/shared বাইরে থাকায় tsc rootDir উপরে তোলে)
- **প্রজেক্ট ফোল্ডার rename করলে `npm install` আবার চালাও** — `node_modules/@shop/*`
  symlink পুরোনো পাথে আটকে থাকে আর `@shop/shared` resolve হওয়া বন্ধ হয়ে যায়
  (পুরো টেস্ট suite "Cannot find module '@shop/shared'" দিয়ে fail করে)
- `packages/shared`-এ নতুন ফাইল লিখলে `src/index.ts`-এ export যোগ করতে ভুলো না,
  আর `npm run build -w @shop/shared` চালাও — api/web `dist` পড়ে, `src` নয়
- argon2 native build লাগে না — `prebuilds/win32-x64` আছে, npm-এর
  "install scripts not covered by allowScripts" warning এখানে ক্ষতিকর নয়
