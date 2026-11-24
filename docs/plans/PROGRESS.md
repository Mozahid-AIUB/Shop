# PROGRESS — কোন phase কোথায়

> প্রতি session-এ **এই ফাইলটা আগে পড়ো**, তারপর শুধু পরের phase-এর sub-plan ফাইল।

| # | Phase | Status | Sub-plan |
|---|---|---|---|
| 01 | Foundation (monorepo, Prisma, health) | ✅ শেষ | `01-foundation.md` |
| 02 | Auth + RBAC | ✅ শেষ (backend) | `02-auth-rbac.md` |
| 03 | Catalog + Inventory | ✅ শেষ (backend) | `03-catalog.md` |
| 04 | Cart + Checkout + Order ID | ✅ শেষ (backend) | `04-cart-checkout.md` |
| 05 | Payments (COD + manual, gateway পরে) | ✅ শেষ (backend) | `05-payments.md` |
| 06 | Order Lifecycle + Tracking | ✅ শেষ (backend) | `06-order-lifecycle.md` |
| 07 | Admin Panel (production + audit) | ✅ শেষ (backend) | `07-admin-panel.md` |
| 08 | Notifications (BullMQ) | ⬜ বাকি | — |
| 09 | Reports + Analytics | ✅ শেষ (backend) | `09-reports.md` |
| 10 | Courier (Steadfast/Pathao/RedX) | ⬜ বাকি | — |
| 11 | Fraud Guard (COD risk) | ⬜ বাকি | — |
| 12 | Tracking (Meta Pixel + CAPI) | ⬜ বাকি | — |
| 13 | Hardening (rate limit, helmet, log) | ✅ শেষ (backend) | `13-hardening.md` |

**এখন কোথায়:** Phase 02-07 আর 13 `main`-এ merge ও **GitHub-এ push, CI সবুজ**।
Phase 09 (Reports) **শেষ** — branch `phase/09-reports`: ৫টা endpoint
(`summary`, `sales`, `best-sellers`, `status-breakdown`, `repeat-customers`),
সবগুলো **শুধু `SUPER_ADMIN`**। টাকার তিনটা সংখ্যা আলাদা:
ordered / collected / due — COD-তে অর্ডার হওয়া আর টাকা পাওয়া এক নয়।
বাতিল অর্ডার টাকার হিসাবে নেই, কিন্তু status breakdown-এ দেখানো হয়
(কত হারাচ্ছি সেটা জানা দরকার)। `admin/` ফোল্ডার sub-folder-এ ভাগ করা হয়েছে:
`production/`, `activity-log/`, `invoice/`, `reports/`।
**২০৬টা API টেস্ট (১৫টা suite) সবুজ**, lint ও build পরিষ্কার
(`packages/shared/dist` মুছে CI-র মতো অবস্থা থেকেও যাচাই করা)।
**পরের কাজ:** Phase 11 — Fraud Guard (বাইরের কিছু লাগে না)।
সিদ্ধান্ত: আগে পুরো backend, UI তারপর।
**Blocker:** Phase 08-এ Redis নেই, Phase 10-এ কুরিয়ার API key নেই,
Phase 12-এ Meta token নেই — ওই তিনটায় তোমার ব্যবস্থা লাগবে।

**Phase 13-এ প্ল্যান থেকে সরানো:** DB backup cron আর VPS deploy (আসল সার্ভার
লাগবে), Playwright E2E (UI লাগবে) — তিনটাই deploy-এর আগে, আলাদা phase-এ।
rate limit এখন **মেমরিতে** — এক instance চলছে বলে যথেষ্ট। Redis বসলে
(Phase 08) throttler storage ওখানে সরাতে হবে, নইলে একাধিক instance-এ
সীমা আলাদা হিসাব করবে।

**Phase 09-এ ইচ্ছাকৃতভাবে করা হয়নি:** pre-aggregated summary table।
দুই জায়গায় সত্য রাখলে তারা আলাদা হয়ে যায় — অর্ডার পরে বাতিল হলে বা
পেমেন্ট void হলে summary row বাসি হয়ে যেত আর রিপোর্ট ভুল সংখ্যা বলত।
ভুল সংখ্যা সংখ্যা না থাকার চেয়েও খারাপ। query plan দেখে যাচাই করা হয়েছে:
২ লাখ row-তে `createdAt` index ব্যবহার হয়, ৩০ দিনের window ২১ms-এ আসে।
**কখন বসাতে হবে:** অর্ডার লাখ ছাড়ালে, বা রিপোর্ট ১ সেকেন্ডের বেশি নিলে।

## সিদ্ধান্ত — Admin কাঠামো (২৪ নভেম্বর ২০২৬)

- **Permission:** এখনকার ৫টা role-ই থাকবে (`SUPER_ADMIN`, `ORDER_MANAGER`,
  `DESIGNER`, `ACCOUNTANT`, `CUSTOMER`)। প্রতি-কর্মীর আলাদা permission table
  **এখন নয়** — দরকার হলে পরে যোগ হবে। `ORDER_MANAGER` কার্যত moderator।
- **Admin module ভাগ করা:** ✅ হয়ে গেছে (Phase 09-এর সাথে)।
  `modules/admin/` এখন: `production/`, `activity-log/`, `invoice/`,
  `reports/` — প্রতিটায় নিজের controller + service। আগের এক
  `admin.controller.ts`-এ ৪টা controller গাদাগাদি করা অবস্থা আর নেই।

**Phase 07-এ প্ল্যান থেকে সরানো:** ফাইল আপলোড (print-ready design) — MinIO
বসার পর Phase 08-এর সাথে হবে। আপলোড পুরো প্রোডাক্টের সবচেয়ে ঝুঁকিপূর্ণ জায়গা
(magic byte, SVG XSS, presigned URL), তাই local disk-এ করে পরে S3-এ সরানোর
বদলে একবারেই আসল storage দিয়ে করা হবে।


## সিদ্ধান্ত — প্রোডাক্টের ধরন (২৪ নভেম্বর ২০২৬)

**এটা SaaS নয়, source code বিক্রির প্রোডাক্ট।** মালিক নিজে ব্যবহার করবে,
আর অন্য ব্যবসায়ীদের কাছে কোড বিক্রি করবে — প্রত্যেকে **নিজের সার্ভারে
নিজের ইনস্টল** চালাবে।

**তাই multi-tenant (`shopId`) করা হবে না** — এক ইনস্টল = এক দোকান।
`shopId` যোগ করলে প্রতিটা query-তে অকারণ ফিল্টার আর জটিলতা বাড়ত,
অথচ দুই দোকানের ডেটা কখনো এক DB-তে থাকবেই না।

**এর ফল যা মাথায় রাখতে হবে:**

- কোনো key, secret বা ব্যবসার নাম কোডে hardcode করা যাবে না —
  সবই `.env`-এ, আর `.env.example`-এ ব্যাখ্যাসহ ফাঁকা রাখতে হবে
- যে কিনবে তার হয়তো প্রথম দিনে কুরিয়ার/SMS-এর চুক্তি থাকবে না,
  তাই **key ছাড়াও সাইট সম্পূর্ণ চলতে হবে** (manual fallback)
- সেটআপ সহজ হতে হবে: `.env` ভরো → migrate → seed → চলে

## সিদ্ধান্ত — কুরিয়ার (Phase 10)

**যার যার API key সে নিজে দেবে।** কারণ key কুরিয়ার কোম্পানির সাথে
করা **ব্যবসার নিজের অ্যাকাউন্টে** বাঁধা — এক key দিয়ে অন্যের পার্সেল
পাঠালে বিল আর COD-র টাকা ভুল লোকের অ্যাকাউন্টে যেত।

**গঠন:** এক interface, একাধিক provider —

```
courier/
  courier.interface.ts   createParcel / trackParcel / cancelParcel
  steadfast.provider.ts
  pathao.provider.ts
  redx.provider.ts
  manual.provider.ts     key ছাড়া ডিফল্ট
```

`.env`-এ `COURIER_PROVIDER` দিয়ে বাছাই, key-ও ওখানেই।

**`manual` provider সবচেয়ে জরুরি:** key না থাকলে অ্যাডমিন হাতে ট্র্যাকিং
নম্বর বসাবে আর সব কাজ চলবে। এটা না থাকলে যে কোড কিনল তার Steadfast
চুক্তি হওয়ার আগ পর্যন্ত সাইটই অচল থাকত।

**`manual` অংশটা এখনই করা যায়** (key লাগে না)। আসল তিনটা provider
লিখতে sandbox key লাগবে — অনুমানে লিখলে ডকুমেন্টেশন আর বাস্তবের
পার্থক্যে ভাঙবে।

## খোলা finding (ship-review থেকে, push আটকায় না)

- **Medium — `GET /orders` unbounded** (`apps/api/src/modules/orders/orders.service.ts:207`):
  কাস্টমারের সব অর্ডার একবারে আসে, pagination নেই। নিয়মিত ক্রেতার কয়েকশো অর্ডার
  হলে response ভারী হবে। Admin board-এ cursor/page আছে, এটায় নেই।
  **কখন ঠিক করব:** Phase 04-এর storefront UI লেখার সময় — তখনই জানা যাবে
  UI কত করে চায়, আর cursor না page সেটাও তখন ঠিক করা সহজ।

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
- **টেস্ট সবসময় `npm run test -w @shop/api` দিয়ে চালাও**, repo root থেকে
  `npx jest --rootDir apps/api` দিয়ে নয়। `app.module.ts`-এ `envFilePath: ['../../.env']`
  আপেক্ষিক — ভুল cwd থেকে চালালে `.env` পড়া হয় না, `DATABASE_URL` খালি থাকে,
  Prisma ডিফল্ট 5432-এ গিয়ে `ECONNREFUSED` দেয় আর **সব টেস্ট fail করে**।
  এটা DB বন্ধ থাকার মতো দেখায়, কিন্তু আসলে cwd-র সমস্যা
- টেস্টে `logger: false` থাকায় 500-এর আসল কারণ লুকিয়ে থাকে। ডিবাগ করতে
  সাময়িকভাবে সরাও, কাজ শেষে ফিরিয়ে দাও
- **লোকালে পাস করা মানে CI-তে পাস নয়** — `packages/shared/dist` কমিট হয় না,
  আর লোকালে আগের build পড়ে থাকে বলে ভাঙা জিনিসও পাস করে। সন্দেহ হলে
  `rm -rf packages/shared/dist` করে তারপর lint+test+build চালাও — CI ঠিক
  এই অবস্থা থেকেই শুরু করে
- **schema-তে নতুন model যোগ করলে `npx prisma generate` চালাও** (apps/api থেকে),
  নইলে `tx.payment does not exist` ধরনের TS error আসে — migration চললেও
  client-এ নতুন টাইপ আসে না
- **তারিখ নিয়ে কাজ করলে টাইমজোন মাথায় রাখো** — এই মেশিনের ঘড়ি ঢাকার,
  কিন্তু CI runner আর VPS প্রায় সবসময় **UTC**। DB থেকে `Date` এনে
  JavaScript-এ ফরম্যাট করলে দিন বদলে যায় (ঢাকার ভোরের অর্ডার UTC-তে
  আগের দিনে পড়ে)। **সমাধান:** দিনের হিসাব Postgres-এই সারো
  (`to_char(... AT TIME ZONE 'Asia/Dhaka', 'YYYY-MM-DD')`), আর
  `main.ts` ও `jest-setup.ts`-এ `TZ=Asia/Dhaka` বাঁধা আছে।
  সন্দেহ হলে `TZ=UTC npm run test -w @shop/api` চালিয়ে দেখো
