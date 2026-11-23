# Master Plan — কাস্টম টি-শার্ট ডিজাইন ও অর্ডার ম্যানেজমেন্ট প্ল্যাটফর্ম

> এটা **master index**। এখানে কোনো কোড নেই — শুধু roadmap, architecture সিদ্ধান্ত আর কোন sub-plan কী করবে।
> বিস্তারিত থাকবে `docs/plans/01..12-*.md` ফাইলে। কাজের সময় **শুধু একটা sub-plan পড়বে**, পুরোটা না।

---

## Context — কেন এই প্রজেক্ট

`d:\Way_To_Job\E-Commerce` এখন খালি (শুধু README + git init, remote: `Mozahid-AIUB/E-Commerce-T-shirt`)। এখান থেকে শূন্য থেকে একটা **রিয়েল বিজনেস** প্ল্যাটফর্ম বানানো হবে যেটা লাইভে যাবে।

**সমস্যা যেটা সমাধান করছি:** কাস্টম টি-শার্ট ব্যবসায় অর্ডার আসে ছড়িয়ে-ছিটিয়ে (মেসেঞ্জার, ফোন, হোয়াটসঅ্যাপ), ডিজাইন ফাইল হারিয়ে যায়, কোন অর্ডার কোন স্টেজে আছে কেউ জানে না, পেমেন্ট বাকি কত হিসাব থাকে না।

**ফলাফল যেটা চাই:** কাস্টমার নিজেই ব্রাউজারে শার্ট ডিজাইন করবে → অর্ডার দেবে → পেমেন্ট করবে। প্রতিটা অর্ডার একটা **Unique Order ID** পাবে (`ORD-2026-0801-018`), যেটা দিয়ে ডিজাইন কনফার্ম থেকে ডেলিভারি পর্যন্ত পুরো journey ট্র্যাক হবে। অ্যাডমিন এক ড্যাশবোর্ড থেকে অর্ডার, প্রোডাকশন, পেমেন্ট, রিপোর্ট — সব চালাবে।

---

## আপনার ৩টা প্রশ্নের সরাসরি উত্তর

### ১. আগে backend শেষ করব, নাকি frontend? → **কোনোটাই না। Vertical Slice করব।**

পুরো backend আগে শেষ করলে ২-৩ মাস কিছুই দেখা যাবে না, আর যে API বানাবেন সেগুলো পরে দেখবেন UI-তে ফিট করে না — রিরাইট করতে হবে। আবার পুরো frontend আগে করলে সব জায়গায় mock data, পরে rewire করা যন্ত্রণা।

**যেটা করব:** প্রতিটা ফিচার আলাদা "slice" — সেই slice-এর ভেতরে ক্রম হলো `Prisma schema → NestJS API → Next.js UI`। প্রতিটা phase শেষে একটা জিনিস **end-to-end চলে**, ডেমো দেওয়া যায়।

```
Phase 1-2  →  Foundation + Auth        (এখানে backend-heavy, উপায় নেই)
Phase 3+   →  প্রতি phase = schema + API + UI একসাথে, শেষে চলমান ফিচার
```

ব্যতিক্রম শুধু Phase 1-2 — DB আর auth ছাড়া কোনো UI-র মানে নেই, তাই ওখানে backend আগে।

### ২. প্ল্যান কীভাবে সাজাব? → **Master index + ১২টা ছোট sub-plan ফাইল**

```
docs/plans/
├── PROGRESS.md          ← ১৫ লাইন। কোন phase কোথায় আছে। প্রতি session-এ প্রথমে এটা পড়বে।
├── 00-master.md         ← এই ফাইলটাই (roadmap, কোড নেই)
├── 01-foundation.md     ← প্রতিটা ~২০০-৩০০ লাইন, নিজে-নিজে সম্পূর্ণ
├── 02-auth-rbac.md
├── ... 12-hardening-deploy.md
```

### ৩. এক ফাইলে বড় প্ল্যান = token শেষ → **এই ৫টা নিয়মে সমাধান**

| নিয়ম | কেন কাজ করে |
|---|---|
| **এক session = এক sub-plan** | পুরো প্ল্যান কখনো context-এ ঢোকে না। শুধু ঐ ২৫০ লাইন। |
| `PROGRESS.md` আগে পড়বে | ১৫ লাইনে জানা যায় কোথায় আছি — বাকি ১১টা ফাইল না পড়েই। |
| রুট-এ `CLAUDE.md` | Convention (naming, folder, commit style) ওখানে একবার — auto-load হয়, প্ল্যানে বারবার লিখতে হয় না। |
| Type থাকবে `packages/shared`-এ | প্ল্যানে interface কপি করতে হয় না, শুধু ফাইল path লিখলেই হয়। |
| Sub-plan-এ কোড নয়, **contract** | "এই endpoint, এই input/output, এই ফাইল" — পুরো implementation লেখা না। |

---

## Tech Stack (version verified — 2026-08-01)

| অংশ | টুল | Version |
|---|---|---|
| Frontend | Next.js (App Router) + React + Tailwind | 16.2.12 / 19.2.8 / 4.3.3 |
| Backend | NestJS | 11.1.28 |
| ORM + DB | Prisma + PostgreSQL | 7.9.1 / 17 |
| Auth | নিজের JWT (access + refresh) + RBAC guards | — |
| ডিজাইন ক্যানভাস | Fabric.js | 7.4.0 |
| 3D প্রিভিউ | Three.js + react-three-fiber | 0.185.1 |
| Queue/Job | BullMQ + Redis | — |
| File Storage | MinIO (local, S3-compatible) → prod-এ S3/R2 | — |
| Infra | **Docker Compose** (সব service) | — |
| Test | Vitest + Playwright (web), Jest + Supertest (api) | — |

**Payment:** SSLCommerz + bKash — কিন্তু `PaymentProvider` interface-এর পিছনে। sandbox ↔ live শুধু env বদলে।

---

## Repo Structure (npm workspaces monorepo)

```
E-Commerce/
├── apps/
│   ├── api/                    # NestJS — সব business logic
│   │   ├── prisma/schema.prisma
│   │   └── src/modules/{auth,users,catalog,designs,orders,payments,production,notifications,reports}
│   └── web/                    # Next.js — storefront + customer + admin
│       └── app/
│           ├── (shop)/         # হোম, ক্যাটালগ, প্রোডাক্ট
│           ├── (studio)/       # ডিজাইন কাস্টমাইজার
│           ├── (account)/      # কাস্টমার ড্যাশবোর্ড, My Orders
│           └── (admin)/        # অ্যাডমিন প্যানেল — role guard-এর পিছনে
├── packages/shared/            # TS types + Zod schema — দুই পাশে shared
├── docker/                     # docker-compose.yml + Dockerfile
├── docs/{specs,plans}/
└── CLAUDE.md                   # convention — auto-load হয়
```

**কেন admin আলাদা app না:** একই Next app-এ `(admin)` route group + middleware role check — এক deploy, shared component, কম maintenance। আলাদা app শুধু তখন লাগে যখন আলাদা টিম আলাদা release cycle-এ কাজ করে।

---

## Core Data Model (Phase 1-এ schema-র কঙ্কাল, পরে বাড়বে)

```
User ─┬─< Order >─┬─< OrderItem >── Design ──< DesignAsset
      │           ├─< OrderStatusHistory      (Fabric JSON + preview PNG)
      │           └─< Payment
      └─< Address

Product ──< ProductVariant (color × size × stock × price)
        └──< ProductPrintMethod (Screen/DTG/Vinyl — আলাদা প্রাইসিং)

Role ──< Permission        ClipartAsset        ActivityLog
ProductionTask ── Order     Coupon             Notification
```

**Order ID (`ORD-2026-0801-018`)** — headline ফিচার, তাই আলাদা করে বলছি: দিনে-দিনে সিরিয়াল রিসেট হয়। Race condition এড়াতে Postgres-এ ডেডিকেটেড `order_counter` টেবিল + `SELECT ... FOR UPDATE` transaction-এর ভেতরে। এটা Phase 6-এর প্রথম কাজ, এবং এর টেস্ট concurrent insert দিয়ে হবে।

---

## Roadmap — ১৩টা Phase

প্রতিটা phase = একটা sub-plan ফাইল = আদর্শভাবে ১-২টা session।

| # | Sub-plan | কী দাঁড়াবে (Done মানে কী) |
|---|---|---|
| 01 | `01-foundation.md` | Postgres চলে, `/health` 200 দেয়, Next হোমপেজ ওঠে, CI সবুজ |
| 02 | `02-auth-rbac.md` | রেজিস্টার/লগইন/রিফ্রেশ কাজ করে, ৫টা role, refresh rotation + reuse detection, `(admin)` route রক্ষিত |
| 03 | `03-catalog.md` | যেকোনো পণ্য — নমনীয় variant + attribute, ক্যাটাগরি গাছ, স্টক, storefront ক্যাটালগ ও PDP |
| 04 | `04-cart-checkout.md` | কার্ট → ঠিকানা → অর্ডার তৈরি, **Unique Order ID জেনারেট**, কনফার্মেশন পেজ |
| 05 | `05-payments.md` | **ছোট রাখা হচ্ছে** — COD + manual/offline payment রেকর্ড + PDF ইনভয়েস। bKash/SSLCommerz gateway আপাতত `mock` adapter-এর পিছনে, আসল integration পরে |
| 06 | `06-order-lifecycle.md` | Status state machine (Pending→…→Delivered), পাবলিক "Track My Order", অ্যাডমিন অর্ডার বোর্ড, সার্চ/ফিল্টার |
| 07 | `07-admin.md` | অর্ডার/প্রোডাক্ট/কাস্টমার/স্টক ব্যবস্থাপনা, রোলভিত্তিক অ্যাক্সেস, activity log |
| 08 | `08-notifications.md` | BullMQ queue, SMS+Email adapter, অর্ডার কনফার্ম/স্ট্যাটাস/পেমেন্ট রিমাইন্ডার ট্রিগার |
| 09 | `09-reports.md` | সেলস চার্ট, best-seller, status pie, revenue vs due, repeat customer |
| 10 | `10-courier.md` | Steadfast/Pathao/RedX adapter, অর্ডার থেকে এক ক্লিকে consignment, webhook দিয়ে delivery status sync |
| 11 | `11-fraud-guard.md` | COD ঝুঁকি স্কোরিং — কুরিয়ার return history, একই ফোন/IP-তে বারবার অর্ডার, auto-block + manual review queue |
| 12 | `12-tracking-pixel.md` | Meta Pixel + Conversions API (server-side), GA4, event dedup (`event_id`), consent |
| 13 | `13-hardening-deploy.md` | Rate limit, validation, structured log, DB backup cron, VPS deploy (Docker ছাড়াও চলবে) |

**Phase 03 আর 07 সবচেয়ে ভারী** — catalog-এ সব রকম প্রোডাক্টের variant, admin-এ বহু ফিচার।

---

## যেভাবে execute হবে (প্রতি session-এর রুটিন)

1. `docs/plans/PROGRESS.md` পড়ো (১৫ লাইন)
2. পরের sub-plan ফাইলটা পড়ো (শুধু ওইটা)
3. TDD — টেস্ট আগে, তারপর কোড
4. Phase-এর সব টেস্ট + lint + build সবুজ হলে commit
5. `PROGRESS.md` আপডেট করে ✅ দাও

---

## Convention (রুটের `CLAUDE.md`-এ যাবে)

- **Git commit-এ Claude/AI-র নাম বা `Co-Authored-By` লাইন থাকবে না** — contributor শুধু আপনি
- Commit style: Conventional Commits (`feat(orders): ...`)
- প্রতি phase নিজের branch-এ, শেষে `main`-এ merge
- Dev মেশিনে Postgres 17 native (port 5433) — এই মেশিনে Docker নেই। VPS-এও Docker ছাড়া deploy হবে
- Secret শুধু `.env`-এ, `.env.example` কমিট হবে, `.env` কখনো না

---

## Verification — কীভাবে বুঝব কাজ করছে

**প্রতি phase-এ:**
```bash
docker compose up -d              # সব service ওঠে
npm run test -w apps/api          # Jest + Supertest
npm run test -w apps/web          # Vitest
npm run build                     # দুই app-ই build হয়
```

**Phase 13-এর শেষে full end-to-end (Playwright):** রেজিস্টার → প্রোডাক্ট বেছে নেওয়া → variant বাছাই → কার্টে যোগ → চেকআউট → sandbox পেমেন্ট → Order ID পাওয়া → ট্র্যাকিং পেজে স্ট্যাটাস দেখা → অ্যাডমিন লগইন করে স্ট্যাটাস বদলানো → কাস্টমার নোটিফিকেশন পাওয়া।

এই পুরো flow একবারে পাস করলে প্ল্যাট‌ফর্ম লাইভে যাওয়ার জন্য প্রস্তুত।

---

## প্রথম ধাপ (approve করলে যা করব)

1. `docs/plans/` বানিয়ে এই master + `PROGRESS.md` + `01-foundation.md` লিখব
2. রুট `CLAUDE.md` লিখব (উপরের convention সহ)
3. তারপর Phase 01 execute — monorepo scaffold + Docker compose + Prisma init + health check

বাকি sub-plan ফাইলগুলো লিখব **যখন ওই phase-এর পালা আসবে** — আগে থেকে ১২টা লিখে রাখলে সেগুলো বাসি হয়ে যাবে, আর token-ও নষ্ট।
