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

- [x] 3.1 Schema: `Product`, `ProductVariant`, `Category` (গাছ), `ProductAttribute` — যেকোনো পণ্যে খাটানো যায় এমন
- [x] 3.2 **টেস্ট:** প্রোডাক্ট CRUD, শুধু admin role
- [x] 3.3 **টেস্ট:** স্টক — negative stock আটকাবে, concurrent decrement
- [x] 3.4 `ProductsService` + controller (admin CRUD)
- [x] 3.5 Public catalog API — list, filter, pagination, single product
- [x] 3.6 দাম **integer paisa**-তে — float নয়, টেস্টে প্রমাণ
- [x] 3.7 প্রোডাক্ট ছবি আপলোড — mime whitelist, সাইজ লিমিট, local disk adapter (পরে S3)

---

## Phase 04 — Cart + Checkout + Order ID

- [x] 4.1 Schema: `Order`, `OrderItem`, `Address`, `OrderStatusHistory`, `order_counter`
- [x] 4.2a **টেস্ট:** order number ফরম্যাট — padding, ৯৯৯ ছাড়ানো, parse, দিনে রিসেট
- [x] 4.2b **টেস্ট:** Order ID — **concurrent insert**, কোনো ডুপ্লিকেট নেই
- [x] 4.3 `OrderNumberService` — কাউন্টার row-এ `ON CONFLICT … RETURNING`, transaction-এর ভেতরে
- [x] 4.4 **টেস্ট:** অর্ডার তৈরি — স্টক কমে, দাম সার্ভারে হিসাব হয় (client-এর পাঠানো দাম বিশ্বাস নয়)
- [x] 4.5 Cart + checkout API — `CartService`, `AddressService`, `OrdersService`, controller
- [x] 4.6 **টেস্ট:** একজন অন্যের কার্ট/অর্ডার ছুঁতে পারে না (৪০৪)
- [x] 4.7 **টেস্ট:** concurrent চেকআউটে oversell নেই — শেষ ১টা পণ্য একজনই পায়
- [ ] 4.8 Storefront UI — পণ্যের তালিকা, কার্ট, চেকআউট পাতা
- [ ] 4.9 অ্যাডমিন অর্ডার তালিকা (Phase 07-এ পুরো প্যানেল)

---

## Phase 05 — Payments ✅ (গেটওয়ে পরে)

- [x] 5.1 Schema: `Payment` — COD + manual entry
- [x] 5.2 `PaymentProvider` interface + `ManualPaymentProvider`
- [x] 5.3 **টেস্ট:** আংশিক পেমেন্ট, due হিসাব (integer paisa), void, role
- [ ] 5.4 PDF invoice — **Phase 07-এ সরানো হলো**, UI-র সাথে
- [ ] ~~bKash/SSLCommerz আসল integration~~ — **পরে**, interface তৈরি থাকবে

---

## Phase 06 — Order Lifecycle ✅

- [x] 6.1 Status state machine — কোন status থেকে কোথায় যাওয়া যায়
- [x] 6.2 **টেস্ট:** অবৈধ transition আটকাবে (Delivered → Pending নয়)
- [x] 6.3 Status change API + history log
- [x] 6.4 Public "Track My Order" — Order ID + ফোন দিয়ে, লগইন ছাড়া
- [x] 6.5 Admin order board — search, filter, pagination

---

## Phase 07 — Admin Panel ✅ (আপলোড বাদে)

- [x] 7.1 Schema: `ProductionTask`, `ActivityLog`
- [ ] 7.2 print-ready ফাইল আপলোড — **MinIO বসার পর**, Phase 08-এর সাথে
- [x] 7.3 Production task assign + status (+ কাজের বোর্ড, filter, pagination)
- [x] 7.4 Activity log — কে কী বদলালো (+ ইনভয়েস ডেটা endpoint)

---

## Phase 08 — Notifications

- [ ] 8.1 Redis লাগবে — ব্যবস্থা করা (native install বা Docker)
- [ ] 8.2 BullMQ queue setup
- [ ] 8.3 SMS + Email adapter (mock আগে)
- [ ] 8.4 Trigger — order confirm, status change, payment reminder
- [ ] 8.5 **টেস্ট:** retry, dead letter

---

## Phase 09 — Reports

- [x] 9.1 Sales aggregate query (date range)
- [x] 9.2 Best seller, status breakdown, revenue vs due
- [x] 9.3 Repeat customer
- [x] 9.4 **টেস্ট:** বড় ডেটায় query slow নয় (index আছে)

---

## Phase 10 — Courier

> **সিদ্ধান্ত (বদলেছে):** key **অ্যাডমিন প্যানেল থেকে** বসানো হয়,
> `.env`-এ নয় — `.env`-এ শুধু এনক্রিপশনের মূল চাবি। key ব্যবসার
> নিজের কুরিয়ার-অ্যাকাউন্টে বাঁধা, তাই যে কোড কিনবে তাকে নিজের key
> বসাতে হবে; সার্ভারে SSH করে ফাইল এডিট করা সে পারবে না।

- [x] 10.1 `CourierProvider` interface — createParcel / track / cancel
- [x] 10.2 **`manual.provider.ts` — key ছাড়াই চলে**
      হাতে ট্র্যাকিং নম্বর বসানো। এটাই ফ্রেশ ইনস্টলের ভরসা,
      তাই অ্যাকাউন্টটা migration-এ তৈরি হয় (seed-এ নয়)
- [x] 10.3 **সেটআপ অ্যাডমিন প্যানেল থেকে** — key DB-তে এনক্রিপ্টেড
      (`.env`-এ শুধু মূল চাবি)। প্ল্যানে আগে `.env`-এ key রাখার কথা
      ছিল; মালিকের সিদ্ধান্তে UI-তে সরানো হলো, কারণ যে ব্যবসায়ী
      কোড কিনবে সে সার্ভারে SSH করে ফাইল এডিট করবে না
- [x] 10.4 Order → consignment (এক ক্লিক) + অর্ডার `SHIPPED`
- [x] 10.5 Webhook গ্রহণ → delivery status sync
- [x] 10.6 **টেস্ট:** webhook signature verify, duplicate webhook
- [x] 10.7 **টেস্ট:** key না থাকলে সাইট চলে (`MANUAL`-এ)
- [x] 10.8 **টেস্ট:** key কখনো response-এ ফেরে না, DB-তে এনক্রিপ্টেড

**Adapter — প্রত্যেকের merchant ডক লাগে:**

- [x] 10.9 Steadfast adapter — **মালিকের merchant API guide ধরে লেখা**
- [x] 10.10 Pathao adapter — **তাদের developer documentation ধরে** (OAuth, টোকেন DB-তে এনক্রিপ্টেড)
- [x] 10.11 RedX adapter — **তাদের OpenAPI documentation ধরে** (এরিয়া lookup + query-token webhook + বাতিল)
- [ ] ~~10.12 Carrybee adapter~~ — **মালিকের সিদ্ধান্তে বাদ**, ডকও পাওয়া যায়নি
- [x] 10.13 পণ্যে ওজনের ঘর (গ্রামে) + কুরিয়ার সেটআপে ডিফল্ট ওজন
- [x] 10.14 খুলে দেখার সুইচ (`allowOpenBox`) — পণ্যভেদে আলাদা, তাই সেটিং

> Steadfast-এর ডক মালিক দিয়েছে, তাই ওটা লেখা হয়ে গেছে — আর ডক পড়েই
> তিনটা জিনিস ধরা পড়ল যা অনুমান করলে ভুল হতো: `cod_amount` টাকায়
> (paisa নয়, নইলে ১০০ গুণ), `delivered_approval_pending` ≠ delivered
> (রাইডারের দাবি, নিশ্চয়তা নয়), আর একই invoice দুবার নেয় না (ফলে
> ফেরত আসা পণ্য আর পাঠানোই যেত না — আমাদের নিজের বাগ)।
>
> বাকি তিনটার ডকও merchant dashboard-এ আছে। Pathao আর RedX-এর ডক
> পাওয়া গেছে; Carrybee-র এখনো নয়। মাঠগুলো
> `COURIER_CREDENTIAL_FIELDS`-এ লেখা, registry-তে এক লাইন যোগ করলেই
> নতুন adapter বসে।

---

## Phase 11 — Fraud Guard

- [x] 11.1 Schema: `FraudCheck` (`CustomerRiskProfile` নয় — কারণ `11-fraud-guard.md`-এ)
- [x] 11.2 Risk score — ফেরতের ইতিহাস, একই ফোনে বারবার অর্ডার, ঠিকানা মিল
- [ ] 11.3 কুরিয়ার return history API (Steadfast) — **API key লাগবে**, Phase 10-এ
- [x] 11.4 ~~Auto-block~~ → **শুধু ফ্ল্যাগ**, ব্লক নয় (সিদ্ধান্ত: আসল ক্রেতা হারানোর ঝুঁকি বেশি)
- [x] 11.5 **টেস্ট:** ভালো কাস্টমার যেন ব্লক না হয় (false positive)

---

## Phase 12 — Tracking

- [ ] 12.1 Meta Conversions API — server-side event
- [ ] 12.2 `event_id` দিয়ে dedup (pixel + CAPI একই event দুবার নয়)
- [ ] 12.3 GA4 measurement protocol
- [ ] 12.4 Consent — না দিলে event যাবে না
- [ ] 12.5 **টেস্ট:** PII hash হয়ে যাচ্ছে (ইমেইল/ফোন কাঁচা যাবে না)

---

## Phase 13 — Hardening + Deploy

- [x] 13.1 Rate limit (`@nestjs/throttler`) — login, register, track order
- [x] 13.2 Helmet, CORS টাইট করা
- [x] 13.3 Structured log (pino) + request id
- [ ] 13.4 DB backup cron — **আসল সার্ভার লাগবে**, deploy-এর সাথে
- [ ] 13.5 VPS deploy — Docker ছাড়াও চলবে এমন ব্যবস্থা — **আসল সার্ভার লাগবে**
- [ ] 13.6 Playwright end-to-end — পুরো flow — **UI লাগবে**

---

## Phase 14 — Shipping Rules

> এখন `shippingPaisa` হার্ডকোড `0` ছিল — মানে **সব ডেলিভারি ফ্রি**।
> নিয়ম DB-তে, কারণ যে কোড কিনবে তার চার্জ ও এলাকা আলাদা হবে।

- [x] 14.1 **টেস্ট:** zone বাছাই — জেলা মিললে সেটা, নইলে default
- [x] 14.2 **টেস্ট:** free-above সীমা, default zone না থাকলে কী হয়
- [x] 14.3 Schema `ShippingZone` + migration + seed (ঢাকা / বাইরে)
- [x] 14.4 `shipping.service.ts` — `quote(district, subtotal)`
- [x] 14.5 checkout-এ যুক্ত — **হার্ডকোড `0` সরানো**
- [x] 14.6 Admin CRUD (`SUPER_ADMIN`)
- [x] 14.7 Public `GET /shipping/quote` — কার্টে দেখাতে

---

## Phase 15 — Coupon + Campaign

> মালিকের চাওয়া: "যখন যেমন ইচ্ছা তেমন অফার" — তাই নকশা নমনীয়।
> **এখানে ভুল হলে সরাসরি টাকা যায়**, তাই টেস্ট সবচেয়ে বেশি।

- [x] 15.1 **টেস্ট:** তিন ধরনের ছাড় (শতকরা / নির্দিষ্ট টাকা / ফ্রি ডেলিভারি)
- [x] 15.2 **টেস্ট:** ছাড় কখনো মোটের চেয়ে বেশি নয়, total ঋণাত্মক নয়
- [x] 15.3 **টেস্ট:** মেয়াদ, সর্বোচ্চ ব্যবহার, প্রতি-ইউজার সীমা, ন্যূনতম অর্ডার
- [x] 15.4 Schema `Coupon` + `CouponRedemption` + migration
- [x] 15.5 `coupon.service.ts` — `validate()` আর `redeem()`
- [x] 15.6 checkout-এ যুক্ত, **একই transaction-এ**
- [x] 15.7 **টেস্ট:** একসাথে দুই অর্ডারে শেষ কুপন — একটাই পাবে (race)
- [x] 15.8 Public `POST /coupons/validate` (rate limited)
- [x] 15.9 Admin CRUD + কোন কুপন কতবার চলল

---

## Phase 16 — Product Search

> Postgres-এর নিজেরই খোঁজা। Elasticsearch/Meilisearch নয় — আরেকটা
> সার্ভার মানে যে কোড কিনবে তার আরেকটা খরচ ও ঝামেলা।

**`tsvector` বাদ দেওয়া হয়েছে — এটা বাংলায় কাজ করে না।** Postgres-এর
full-text parser "শব্দ" কী সেটা OS-এর ctype থেকে ঠিক করে। যে DB-র
ctype UTF-8 নয় (Windows-এ ডিফল্ট, যেখানে এটা বানানো হচ্ছে), সেখানে
প্রতিটা বাংলা অক্ষর **blank** ধরা হয়, তাই
`to_tsvector('simple', 'নীল শার্ট')` কিছুই ফেরায় না — GIN index পুরো
ফাঁকা থাকত। `pg_trgm`-ও একইভাবে ব্যর্থ: `show_trgm('শার্ট')` = `{}`।

এটা tuning-এর সমস্যা নয়, যে ভাষায় বেশিরভাগ ক্রেতা টাইপ করে সেই
ভাষাতেই ফিচারটা অনুপস্থিত থাকত। **তাই ILIKE** — byte মিলায়, তাই
বাংলা/ইংরেজি/মিশ্র সবই চলে, আর আংশিক শব্দেও মেলে (ক্রেতা পুরো শব্দ
লেখে না)। খরচ: sequential scan, কিন্তু এই আকারের ক্যাটালগে (হাজার,
কোটি নয়) কয়েক মিলিসেকেন্ড।

- [x] 16.1 **টেস্ট:** নাম / ক্যাটাগরি / বিবরণে খোঁজা, ক্রম ঠিক
- [x] 16.2 **টেস্ট:** বাংলা লেখায় খোঁজা (পুরো নাম, এক শব্দ, আংশিক, বিবরণ)
- [x] 16.3 প্রাসঙ্গিকতার ক্রম: নাম-শুরু > নামে > ক্যাটাগরিতে > বিবরণে
- [x] 16.4 `GET /products/search?q=` — keyset pagination সহ
- [x] 16.5 **টেস্ট:** খসড়া পণ্য ফলাফলে আসে না
- [x] 16.6 খালি ফলাফলে ক্যাটাগরির সাজেশন
- [x] 16.7 **টেস্ট:** `%` আর `_` লেখা হিসেবে গণ্য হয়, wildcard নয়

**সাথে তিনটা পুরোনো bug সারানো হয়েছে** (`GET /products`):

- [x] 16.8 `sort=price_asc/desc` **দাম** ধরে সাজায় — আগে
  `variants: { _count: ... }` লেখা ছিল, অর্থাৎ **variant-এর সংখ্যা**
  ধরে সাজাত। ক্রেতা "কম দাম আগে" চেপে এলোমেলো ক্রম পেত
- [x] 16.9 `search=` ক্যাটাগরির নামেও খোঁজে — ক্রেতা অনেক সময়
  বিভাগের নামই লেখে
- [x] 16.10 `search=%` আর পুরো ক্যাটালগ ফেরায় না। Prisma-র `contains`
  ভেতরে `ILIKE ('%' || $1 || '%')` বানায় আর মানটা **escape করে না**
  (যাচাই করা হয়েছে), তাই `%` লিখে সব পণ্য টেনে আনা যেত

---

## Phase 17 — Review + Rating

- [x] 17.1 **টেস্ট:** যে কেনেনি সে রিভিউ দিতে পারে না (403)
- [x] 17.2 **টেস্ট:** একই অর্ডার-আইটেমে দুবার রিভিউ নয় (409)
- [x] 17.3 **টেস্ট:** অননুমোদিত রিভিউ public-এ দেখা যায় না
- [x] 17.4 Schema `Review` + migration (`20261124100000_add_review`)
- [x] 17.5 `review.service.ts` + public/customer/admin endpoint
- [x] 17.6 গড় রেটিং — **হিসাব করা হয়, সংরক্ষণ নয়**; তালিকা, detail আর সার্চে
- [x] 17.7 **টেস্ট:** ডেলিভারি হওয়ার আগে রিভিউ নয় (403)
- [x] 17.8 অ্যাডমিনের জবাব, আর জবাব মোছা
- [x] 17.9 লেখক নিজের রিভিউ বদলাতে ও মুছতে পারে
- [x] 17.10 **টেস্ট:** রিভিউ সম্পাদনা করলে অনুমোদন চলে যায়

**বাস্তবায়নের সময় যে সিদ্ধান্তগুলো প্ল্যানে ছিল না:**

- **গেস্ট রিভিউ দিতে পারবে না** (মালিকের সিদ্ধান্ত)। প্ল্যানটা Phase
  18-এর আগে লেখা, তখন সবাই লগইন করত। গেস্টের পরিচয় শুধু ফোন — অর্ডার
  নম্বর আর ফোন কুরিয়ারের লোক, দোকানের কর্মী, এমনকি পার্সেলের স্টিকার
  দেখে যে কেউ জানতে পারে; ওটা দিয়ে রিভিউ খুললে ভুয়া রিভিউর দরজা খুলত
- **শুধু `DELIVERED` হলে** রিভিউ (মালিকের সিদ্ধান্ত)। পণ্য হাতে না
  পেয়ে লেখা রিভিউ পণ্যের রিভিউ নয়, অপেক্ষার বিরক্তি। COD-তে
  `DELIVERED` মানে টাকাও পাওয়া হয়েছে, তাই সংকেতটা সবচেয়ে বিশ্বস্ত
- **`Review.productId` আলাদা কপি করা হয়**, `orderItem.variant` ধরে
  যাওয়া হয় না। variant মুছলে `OrderItem.variantId` `null` হয়ে যায়
  (`SetNull`), আর রিভিউ variant-এর নয় — **পণ্যের**। সাইজ বা রং বন্ধ
  করলে ক্রেতার লেখা রিভিউ হারানো চলবে না
- **সম্পাদনা করলে `isApproved` আবার `false`**। নইলে ভালো রিভিউ
  অনুমোদন করিয়ে নিয়ে পরে লেখা বদলে গালি বা প্রতিযোগীর বিজ্ঞাপন বসিয়ে
  দেওয়া যেত — moderation তখন অর্থহীন
- **মালিকানা আগে যাচাই, তারপর অর্ডারের অবস্থা।** উল্টো করলে "ডেলিভার
  হয়নি" বার্তা দিয়েই কেউ অন্যের অর্ডার কোথায় আছে বুঝে ফেলত
- **`summariesFor()` একটা `groupBy`-তে অনেক পণ্যের রেটিং আনে** — নইলে
  ২৪টা পণ্যের তালিকায় ২৪টা query হতো (N+1)
- `products.service.ts` ৩৫৪ লাইন হয়ে গিয়েছিল, তাই select আর view
  টাইপ `product-views.ts`-এ সরানো হয়েছে (`order-views.ts`-এর মতোই)

---

## Phase 18 — Guest Checkout

> এখন **অ্যাকাউন্ট ছাড়া কেনা যায় না** — বাংলাদেশে বড় বাধা।
> `Order.userId` nullable করা **ঝুঁকিপূর্ণ**: ownership যাচাইয়ের
> প্রতিটা জায়গা আবার দেখতে হবে।

- [x] 18.1 **টেস্ট:** গেস্ট অর্ডার দিতে পারে
- [x] 18.2 **টেস্ট:** এক গেস্টের token-এ অন্যের cart দেখা যায় না
- [x] 18.3 **টেস্ট:** লগইন ইউজারের অর্ডার গেস্ট দেখতে পায় না
- [x] 18.4 Schema: `Order.userId` nullable + guest cart token
- [x] 18.5 cart ও checkout-এ গেস্ট পথ
- [x] 18.6 `@OptionalAuth()` — guard-এর তৃতীয় অবস্থা
- [x] 18.7 `CartOwner` union — ownership যাচাই এক জায়গায়
- [x] 18.8 **টেস্ট:** গেস্ট অর্ডার অ্যাডমিন প্যানেলে দেখা যায়
- [x] 18.9 কুপনে `maxUsesPerUser: null` — গেস্টও পাবে
- [x] 18.10 গেস্টের বড় COD ঝুঁকির স্কোরে আসে
- [x] 18.11 `POST /cart/merge` — লগইনের পর গেস্ট কার্ট হারায় না

**বাতিল — 18.x অ্যাকাউন্ট খোলার সময় পুরোনো অর্ডার জোড়া (ফোন মিলিয়ে)**

মালিকের সিদ্ধান্তে বাদ, নিরাপত্তার কারণে। রেজিস্ট্রেশনে ফোন যাচাই
হয় না, তাই কেউ পরিচিতের নম্বর বসিয়ে অ্যাকাউন্ট খুললে তার কী
কিনেছে আর কোথায় থাকে সব দেখে ফেলত — নীরব তথ্য ফাঁস। গেস্ট
`POST /track`-এ অর্ডার নম্বর **আর** ফোন দিয়ে দেখে, দুটোই জানা লাগে।
OTP (Phase 08) হলে এটা আবার ভাবা যাবে।

---

## Phase 19 — Wishlist

- [ ] 19.1 **টেস্ট:** নিজের উইশলিস্টই দেখা যায়
- [ ] 19.2 Schema (`userId` + `variantId`, unique) + migration
- [ ] 19.3 CRUD endpoint
- [ ] 19.4 **টেস্ট:** একই পণ্য দুবার যোগ করলে একটাই থাকে

---

## Phase 20 — Return + Refund

> `Payment`-এ `REFUNDED` আগে থেকেই আছে, কিন্তু "পণ্য ফেরত"
> প্রক্রিয়া নেই — এখন শুধু অর্ডার বাতিল করা যায়।

- [ ] 20.1 **টেস্ট:** সময়সীমার পরে ফেরত চাওয়া যায় না
- [ ] 20.2 **টেস্ট:** রিফান্ডের পর পেমেন্টের হিসাব মেলে
- [ ] 20.3 Schema `ReturnRequest` + migration
- [ ] 20.4 `return.service.ts` + endpoint
- [ ] 20.5 স্টক ফেরত — **অ্যাডমিন সিদ্ধান্ত নেবে** (ছাপা শার্ট বিক্রিযোগ্য নয়)
- [ ] 20.6 রিপোর্টে ফেরতের হার

---

## Phase 21 — Banner / CMS

> হোমপেজের ছবি ও অফারের পোস্টার বদলাতে যেন deploy না লাগে।

- [ ] 21.1 Schema `Banner` (ছবি, লিংক, ক্রম, সময়সীমা, সক্রিয়)
- [ ] 21.2 **টেস্ট:** মেয়াদ শেষ banner public-এ আসে না
- [ ] 21.3 Admin CRUD + public তালিকা
- [ ] 21.4 `StaticPage` — শর্তাবলী, গোপনীয়তা নীতি, যোগাযোগ
- [ ] 21.5 ছবি আপলোড — **MinIO লাগবে**, আপাতত URL

---

## Phase 22 — SEO

- [ ] 22.1 Schema: `metaTitle`, `metaDescription` (Product, Category)
- [ ] 22.2 `GET /sitemap-data` — web যেখান থেকে sitemap বানাবে
- [ ] 22.3 **টেস্ট:** খসড়া পণ্য sitemap-এ নেই
- [ ] 22.4 slug বদলালে পুরোনো slug redirect (`ProductSlugHistory`)

---

## চলতি নিয়ম

- টাকা **সবসময় integer paisa** — float কোথাও নয়
- `any` টাইপ নিষেধ
- সব input Zod/class-validator দিয়ে validate
- Shared type `packages/shared`-এ, ডুপ্লিকেট নয়
- Push-এর আগে `/ship-review`
