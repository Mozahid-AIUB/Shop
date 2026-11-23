# Backend TODO — এক এক করে

> সব backend কাজ এক জায়গায়। প্রতিটা ✅ হলে এই ফাইল + `PROGRESS.md` দুটোই আপডেট হবে।
> নিয়ম: **এক সময়ে একটাই sub-task**, টেস্ট আগে, সবুজ হলে পরেরটা।

---

## Phase 00 — Environment ✅

- [x] PostgreSQL 17 install (winget, port 5433)
- [x] `tshirt` role + `tshirt_db` database তৈরি
- [x] `prisma migrate deploy` → `users` টেবিল আছে যাচাই
- [x] `npm run dev` → `/health` 200 দেয়

---

## Phase 02 — Auth + RBAC → `02-auth-rbac.md`

- [x] 2.1 `RefreshToken` model + migration
- [x] 2.2 `packages/shared`-এ auth Zod schema
- [x] 2.3 `argon2`, `@nestjs/jwt`, `cookie-parser` install
- [x] 2.4 **টেস্ট:** register → login → me → refresh → logout
- [x] 2.5 **টেস্ট:** security — ভুল পাসওয়ার্ড, ডুপ্লিকেট, reuse detection, inactive
- [x] 2.6 **টেস্ট:** `RolesGuard` — CUSTOMER admin route-এ 403
- [x] 2.7 `TokenService` + `AuthService` + controller
- [x] 2.8 Global `JwtAuthGuard` + `@Public()` (`/health` খোলা থাকবে)
- [x] 2.9 `seed.ts` — প্রথম Super Admin
- [ ] 2.10 Next middleware + session helper

---

## Phase 03 — Catalog + Inventory

- [ ] 3.1 Schema: `Product`, `ProductVariant`, `Category` (গাছ), `ProductAttribute` — যেকোনো পণ্যে খাটানো যায় এমন
- [ ] 3.2 **টেস্ট:** প্রোডাক্ট CRUD, শুধু admin role
- [ ] 3.3 **টেস্ট:** স্টক — negative stock আটকাবে, concurrent decrement
- [ ] 3.4 `ProductsService` + controller (admin CRUD)
- [ ] 3.5 Public catalog API — list, filter, pagination, single product
- [ ] 3.6 দাম **integer paisa**-তে — float নয়, টেস্টে প্রমাণ
- [ ] 3.7 প্রোডাক্ট ছবি আপলোড — mime whitelist, সাইজ লিমিট, local disk adapter (পরে S3)

---

## Phase 04 — Cart + Checkout + Order ID

- [ ] 4.1 Schema: `Order`, `OrderItem`, `Address`, `OrderStatusHistory`, `order_counter`
- [ ] 4.2 **টেস্ট:** Order ID — **concurrent insert**, দিনে রিসেট, কোনো ডুপ্লিকেট নেই
- [ ] 4.3 `OrderIdService` — `SELECT ... FOR UPDATE` transaction-এ
- [ ] 4.4 **টেস্ট:** অর্ডার তৈরি — স্টক কমে, দাম সার্ভারে হিসাব হয় (client-এর পাঠানো দাম বিশ্বাস নয়)
- [ ] 4.5 Cart + checkout API

---

## Phase 05 — Payments (ছোট রাখা হচ্ছে)

- [ ] 5.1 Schema: `Payment` — COD + manual entry
- [ ] 5.2 `PaymentProvider` interface + `mock` adapter
- [ ] 5.3 **টেস্ট:** আংশিক পেমেন্ট, due হিসাব (integer paisa)
- [ ] 5.4 PDF invoice
- [ ] ~~bKash/SSLCommerz আসল integration~~ — **পরে**, interface তৈরি থাকবে

---

## Phase 06 — Order Lifecycle

- [ ] 6.1 Status state machine — কোন status থেকে কোথায় যাওয়া যায়
- [ ] 6.2 **টেস্ট:** অবৈধ transition আটকাবে (Delivered → Pending নয়)
- [ ] 6.3 Status change API + history log
- [ ] 6.4 Public "Track My Order" — Order ID + ফোন দিয়ে, লগইন ছাড়া
- [ ] 6.5 Admin order board — search, filter, pagination

---

## Phase 07 — Admin Panel

- [ ] 7.1 Schema: `ProductionTask`, `ActivityLog`
- [ ] 7.2 Designer panel API — print-ready ফাইল আপলোড + approval
- [ ] 7.3 Production task assign + status
- [ ] 7.4 Activity log — কে কী বদলালো

---

## Phase 08 — Notifications

- [ ] 8.1 Redis লাগবে — ব্যবস্থা করা (native install বা Docker)
- [ ] 8.2 BullMQ queue setup
- [ ] 8.3 SMS + Email adapter (mock আগে)
- [ ] 8.4 Trigger — order confirm, status change, payment reminder
- [ ] 8.5 **টেস্ট:** retry, dead letter

---

## Phase 09 — Reports

- [ ] 9.1 Sales aggregate query (date range)
- [ ] 9.2 Best seller, status breakdown, revenue vs due
- [ ] 9.3 Repeat customer
- [ ] 9.4 **টেস্ট:** বড় ডেটায় query slow নয় (index আছে)

---

## Phase 10 — Courier

- [ ] 10.1 `CourierProvider` interface
- [ ] 10.2 Steadfast adapter
- [ ] 10.3 Pathao adapter
- [ ] 10.4 RedX adapter
- [ ] 10.5 Order → consignment (এক ক্লিক)
- [ ] 10.6 Webhook → delivery status sync
- [ ] 10.7 **টেস্ট:** webhook signature verify, duplicate webhook

---

## Phase 11 — Fraud Guard

- [ ] 11.1 Schema: `CustomerRiskProfile`, `FraudSignal`
- [ ] 11.2 Risk score — return history, একই ফোন/IP-তে বারবার অর্ডার, ঠিকানা মিল
- [ ] 11.3 কুরিয়ার return history API (Steadfast fraud check)
- [ ] 11.4 Auto-block নিয়ম + manual review queue
- [ ] 11.5 **টেস্ট:** ভালো কাস্টমার যেন ব্লক না হয় (false positive)

---

## Phase 12 — Tracking

- [ ] 12.1 Meta Conversions API — server-side event
- [ ] 12.2 `event_id` দিয়ে dedup (pixel + CAPI একই event দুবার নয়)
- [ ] 12.3 GA4 measurement protocol
- [ ] 12.4 Consent — না দিলে event যাবে না
- [ ] 12.5 **টেস্ট:** PII hash হয়ে যাচ্ছে (ইমেইল/ফোন কাঁচা যাবে না)

---

## Phase 13 — Hardening + Deploy

- [ ] 13.1 Rate limit (`@nestjs/throttler`) — login, register, track order
- [ ] 13.2 Helmet, CORS টাইট করা
- [ ] 13.3 Structured log (pino) + request id
- [ ] 13.4 DB backup cron
- [ ] 13.5 VPS deploy — Docker ছাড়াও চলবে এমন ব্যবস্থা
- [ ] 13.6 Playwright end-to-end — পুরো flow

---

## চলতি নিয়ম

- টাকা **সবসময় integer paisa** — float কোথাও নয়
- `any` টাইপ নিষেধ
- সব input Zod/class-validator দিয়ে validate
- Shared type `packages/shared`-এ, ডুপ্লিকেট নয়
- Push-এর আগে `/ship-review`
