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
| 10 | Courier (ভিত্তি + নিজের ডেলিভারি) | ✅ শেষ (backend) | `10-courier.md` |
| 11 | Fraud Guard (COD risk) | ✅ শেষ (backend) | `11-fraud-guard.md` |
| 12 | Tracking (Meta Pixel + CAPI) | ⬜ বাকি | — |
| 13 | Hardening (rate limit, helmet, log) | ✅ শেষ (backend) | `13-hardening.md` |
| 14 | Shipping Zones (ডেলিভারি চার্জ) | ✅ শেষ (backend) | `14-commerce-essentials.md` |
| 15 | Coupon + Campaign | ✅ শেষ (backend) | `14-commerce-essentials.md` |
| 16 | Product Search | ✅ শেষ (backend) | `14-commerce-essentials.md` |
| 17 | Review + Rating | ✅ শেষ (backend) | `14-commerce-essentials.md` |
| 18 | Guest Checkout | ✅ শেষ (backend) | `18-guest-checkout.md` |
| 19-22 | Wishlist, Return, CMS, SEO | ⬜ বাকি | `14-commerce-essentials.md` |

**এখন কোথায়:** Phase 02-07, 09, 10, 11, 13, 14, 15, 16, 17, 18 — সব `main`-এ merge ও push।
বাকি Phase 19-22 (e-commerce-র বাদ পড়া মডিউলগুলো)।

Phase 11 (Fraud Guard) শেষ — COD ঝুঁকির স্কোর checkout-এ, কিন্তু
**কখনো অর্ডার আটকায় না** (সিদ্ধান্ত: আসল ক্রেতা হারানোর ক্ষতি অদৃশ্য
ও স্থায়ী)। সংকেত: ফেরতের ইতিহাস, একই ফোনে বারবার অর্ডার, নতুন
অ্যাকাউন্ট + বড় COD, একই ঠিকানা। সফল ডেলিভারি স্কোর কমায়।
কারণসহ সংরক্ষিত হয়, যাতে অ্যাডমিন জানে ফোনে কী জিজ্ঞেস করতে হবে।

Phase 14 (Shipping) শেষ — ডেলিভারি চার্জ এখন **DB থেকে, অ্যাডমিন
প্যানেলের নিয়ম মেনে**। আগে `shippingPaisa` হার্ডকোড `0` ছিল, অর্থাৎ
প্রতিটা ডেলিভারি মালিকের পকেট থেকে যেত আর কোথাও ভুল দেখাত না।
ফ্রি ডেলিভারির সীমা zone-ভিত্তিক (ঢাকায় দেওয়া যায়, বাইরে না)।

Phase 15 (Coupon) শেষ — তিন ধরনের ছাড়: শতাংশ (সর্বোচ্চ সীমা সহ),
নির্দিষ্ট টাকা, আর ফ্রি ডেলিভারি। **ছাড় কখনো ক্লায়েন্ট থেকে নেওয়া
হয় না** — API শুধু কোড নেয়, হিসাব সার্ভারে। মেয়াদ, সর্বোচ্চ ব্যবহার,
প্রতি-ইউজার সীমা, ন্যূনতম অর্ডার — সব অ্যাডমিন ঠিক করে, কোডে কিছু নয়।

Phase 10 (Courier) — **ভিত্তি শেষ, নিজের ডেলিভারি পুরো কাজ করছে**।

অর্ডার এক ক্লিকে কুরিয়ারে যায়, অর্ডার `SHIPPED` হয়, webhook এলে
নিজে থেকে `DELIVERED` হয়। `MANUAL` (নিজের ডেলিভারি) **key ছাড়াই
চলে** আর অ্যাকাউন্টটা migration-এ তৈরি হয় — তাই ফ্রেশ ইনস্টলে
কুরিয়ারের চুক্তি হওয়ার আগেই দোকান চালু করা যায়।

**সেটআপ পুরোটা অ্যাডমিন প্যানেল থেকে** (মালিকের সিদ্ধান্ত; প্ল্যানে
আগে `.env`-এ key রাখার কথা ছিল)। `.env`-এ শুধু
`COURIER_SECRET_KEY` — এনক্রিপশনের মূল চাবি, কোনো কুরিয়ারের key নয়।
key DB-তে AES-256-GCM দিয়ে এনক্রিপ্টেড, response-এ কখনো ফেরে না
(শুধু শেষ ৪ অক্ষর), আর webhook secret ছাড়া webhook ৪০১।

**Steadfast adapter তৈরি** — মালিক তাদের merchant API guide দিয়েছে।
ডক পড়েই তিনটা ভুল আটকানো গেল: `cod_amount` টাকায় (paisa পাঠালে ১০০
গুণ টাকা তোলা হতো), `delivered_approval_pending` ≠ delivered (রাইডারের
দাবি, নিশ্চয়তা নয় — ডকেই লেখা "do not settle your books on it"), আর
একই invoice দুবার নেয় না — শেষটা **আমাদের নিজের একটা বাগ ধরিয়ে দিল**:
ফেরত আসা অর্ডার আবার পাঠাতে গেলে একই নম্বর যেত আর তারা না বলত।

**Pathao adapter-ও তৈরি** — OAuth, তাই টোকেন DB-তে এনক্রিপ্ট করে
জমা থাকে (মালিকের সিদ্ধান্ত)। মেয়াদ ৫ দিন, শেষের ৫ মিনিট আগেই নতুন
নেওয়া হয়। ওজন কেজিতে পাঠাতে হয় বলে **পণ্যে ওজনের ঘর যোগ করা হলো**
(গ্রামে, integer — টাকার মতোই নীতি), আর কুরিয়ার সেটআপে একটা ডিফল্ট
ওজন। ১০ কেজির বেশি পার্সেল কম ওজন দেখিয়ে পাঠানো হয় না — রাইডার
তুলতে গিয়ে ফিরে যেত আর দোষটা দোকানের দিকেই আসত।

**RedX-ও তৈরি।** তিন জায়গায় আলাদা: জেলার নাম থেকে তাদের
`delivery_area_id` মেলাতে হয় (ক্যাশ করা), webhook-এ signature নেই —
credential query parameter-এ আসে, আর **একমাত্র কুরিয়ার যার API দিয়ে
পার্সেল বাতিল করা যায়**।

**খুলে দেখার সুইচ** (`allowOpenBox`) কুরিয়ার সেটআপে — ক্রেতা টাকা
দেওয়ার আগে পার্সেল খুলে দেখতে পারবে কি না। হার্ডকোড করা যায় না,
কারণ উত্তরটা পণ্যের উপর নির্ভর করে: ইলেকট্রনিক্সে খুলে দেখা **দরকার**
(না দেখে কেউ বড় অঙ্ক দেয় না), কাস্টম ছাপা বা সিল করা পণ্যে
**ক্ষতিকর** (ফেরত এলে আর বেচা যায় না)। ডিফল্ট চালু।

**Carrybee বাদ** — মালিকের সিদ্ধান্ত, ডকও পাওয়া যায়নি। `COURIERS`
তালিকায় রয়ে গেছে যাতে পরে ফেরানো সহজ হয়; registry-তে না থাকায়
প্যানেলে "সংযোগ তৈরি হয়নি" দেখাবে।
চারটার কারোরই আসল API ডক পাবলিক নয় — শুধু third-party wrapper, আর
তাদের মধ্যেই অমিল। অনুমান করে লিখলে key বসানোর পর ব্যর্থ হতো আর
কারণ বোঝা যেত না। **মালিকের merchant dashboard-এর ডক + sandbox key
লাগবে**; registry-তে একটা লাইন যোগ করলেই নতুন adapter বসে।

**"শুধু টি-শার্ট" ধারণা মুছে ফেলা হয়েছে।** README, CLAUDE.md,
master plan, হোমপেজের শিরোনাম আর ব্রাউজার ট্যাবের নাম — সবখানে
আগে কাস্টম টি-শার্টের দোকান লেখা ছিল। এখন **যেকোনো পণ্যের**
ই-কমার্স; কাস্টম ডিজাইন স্টুডিও একটা **ফিচার**, ভিত্তি নয়।
infrastructure-এর নাম (`tshirt` DB role, `tshirt-designs` bucket)
ইচ্ছাকৃতভাবে বদলানো হয়নি — ওগুলো চলমান install-এর আসল নাম,
বদলালে সবাইকে DB নতুন করে বানাতে হতো, লাভ শূন্য।

**web টেস্ট ভাঙা ছিল** (`Cannot read properties of undefined
(reading 'config')`) — আমার কোডের দোষ নয়। `@testing-library/react`
CJS আর সে `require('@testing-library/dom')` করে, কিন্তু Vite ওই
package-এর `module` মাঠ দেখে **ESM** build ধরিয়ে দিত, যার namespace
object-এ named export গুলো CJS-র মতো বসে না। `vitest.config.mts`-এ
CJS build-টা alias করে দেখিয়ে দেওয়া হয়েছে।

Phase 16 (সার্চ) শেষ — `GET /products/search?q=`।

**প্ল্যানে `tsvector` লেখা ছিল, সেটা বাদ দিতে হয়েছে — বাংলায় কাজ
করে না।** Postgres-এর full-text parser "শব্দ" কী সেটা OS-এর ctype
থেকে ঠিক করে; ctype UTF-8 না হলে (Windows-এ ডিফল্ট) প্রতিটা বাংলা
অক্ষর **blank** ধরা হয়। যাচাই করে দেখা:
`to_tsvector('simple','নীল শার্ট')` → ফাঁকা, আর
`ts_debug` বাংলা অংশকে `blank` বলে। `pg_trgm`-ও একই:
`show_trgm('শার্ট')` → `{}`। অর্থাৎ GIN index বানালেও সেটা
বাংলা পণ্যের জন্য **সম্পূর্ণ ফাঁকা** থাকত আর সার্চ চুপচাপ কিছুই
ফেরাত না।

তাই **ILIKE**, প্রাসঙ্গিকতার ক্রমসহ: নাম-দিয়ে-শুরু > নামে আছে >
ক্যাটাগরির নামে > বিবরণে। ক্রমটা SQL-এর একটা `CASE`-এ, কারণ Prisma
"কোথায় মিলল সেটা ধরে স্কোর" প্রকাশ করতে পারে না। খালি ফলাফলে
ক্যাটাগরির সাজেশন যায় — "কিছু পাওয়া যায়নি" বললে ক্রেতা চলে যায়।

**সাথে `GET /products`-এর তিনটা আসল bug সারানো হয়েছে:**

১. `sort=price_asc` **দাম নয়, variant-এর সংখ্যা** ধরে সাজাত
(`variants: { _count: 'asc' }`)। ক্রেতা "কম দাম আগে" চেপে এলোমেলো
ক্রম পেত — সরাসরি বিক্রি হারানোর মতো bug। ঠিক করতে ক্রমটা SQL-এ
নিতে হয়েছে, কারণ ক্রেতা যে দাম দেখে সেটা সম্পর্কিত টেবিলের
`MIN(pricePaisa)`, আর Prisma-র `orderBy` সেটা পারে না।

২. `search=` ক্যাটাগরির নামে খুঁজত না।

৩. **`search=%` পুরো ক্যাটালগ ফেরাত।** Prisma-র `contains` ভেতরে
`ILIKE ('%' || $1 || '%')` বানায় আর মানটা escape করে না — query
log দেখে যাচাই করা। এখন `escapeLikePattern` দিয়ে `%`, `_` আর `\`
escape হয়। এটা SQL injection নয় (সেটা parameter ঠেকায়), এটা
**wildcard injection** — আলাদা সমস্যা, আর parameter দিয়ে ঠেকে না।

Phase 17 (রিভিউ) শেষ — **শুধু যে পণ্যটা হাতে পেয়েছে সে লিখতে পারে**।

রিভিউ বাঁধা থাকে একটা **অর্ডার-আইটেমের** সাথে, এক-এক করে
(`orderItemId @unique`)। তাই ১০টা ৫-তারা রিভিউ লিখতে ১০বার কিনতে
হবে — ভুয়া রিভিউর বিরুদ্ধে এটাই সবচেয়ে সস্তা প্রতিরোধ, কোনো
moderation এর সমান হয় না। নতুন রিভিউ **ডিফল্টে লুকানো**
(`isApproved: false`), অ্যাডমিন অনুমোদন করলে দেখা যায়।

**যা প্ল্যানে ছিল না, মালিকের সিদ্ধান্তে ঠিক হয়েছে:**

- **গেস্ট রিভিউ দিতে পারবে না।** প্ল্যানটা Phase 18-এর আগে লেখা।
  গেস্টের পরিচয় শুধু ফোন, আর অর্ডার নম্বর + ফোন কুরিয়ারের লোক থেকে
  পার্সেলের স্টিকার পর্যন্ত অনেকেই জানে — ওটা দিয়ে রিভিউ খুললে
  যাচাইয়ের পুরো মানেটাই চলে যেত
- **শুধু `DELIVERED` হলে।** পণ্য না পেয়ে লেখা রিভিউ পণ্যের রিভিউ নয়,
  অপেক্ষার বিরক্তি। COD-তে `DELIVERED` মানে টাকাও পাওয়া হয়েছে

**গড় রেটিং কখনো জমানো হয় না**, সবসময় হিসাব করে নেওয়া হয়। টেস্টে
এটা ধরা আছে: একটা অনুমোদিত রিভিউ আবার অনুমোদনহীন করলে গড় ৪.৫ থেকে
৪-এ নেমে আসে। জমানো থাকলে ৪.৫ রয়ে যেত আর **কেউ টের পেত না** —
বাসি রেটিং ভুল রেটিংয়ের চেয়ে খারাপ।

দুটো সূক্ষ্ম জায়গা যেখানে ভুল করা সহজ ছিল:

১. **`Review.productId` আলাদা কপি হয়**, `orderItem.variant` ধরে যাওয়া
হয় না। variant মুছলে `OrderItem.variantId` `null` হয় (`SetNull`) —
পুরোনো অর্ডারের ইতিহাস রাখার জন্য ইচ্ছাকৃত। কিন্তু রিভিউ variant-এর
নয়, **পণ্যের**; সাইজ বা রং বন্ধ করলে ক্রেতার রিভিউ হারানো চলবে না।

২. **সম্পাদনা করলে অনুমোদন চলে যায়।** নইলে "দারুণ!" লিখে অনুমোদন
করিয়ে নিয়ে পরে সেটা বদলে গালি বা প্রতিযোগীর বিজ্ঞাপন বসিয়ে দেওয়া
যেত — moderation তখন শুধু লোক দেখানো।

Phase 18 (Guest Checkout) শেষ — **অ্যাকাউন্ট ছাড়া কেনা যায়**।
অর্ডার অ্যাডমিন প্যানেলে সদস্যের অর্ডারের মতোই দেখায় (নাম-ফোন
`shipFullName`/`shipPhone`-এ থাকে)। তিনটা সিদ্ধান্ত নথিবদ্ধ:

- গেস্ট অর্ডার পরে অ্যাকাউন্টে **জোড়া হয় না** — ফোন যাচাই (OTP)
  ছাড়া জোড়া দিলে কেউ পরিচিতের নম্বর বসিয়ে তার কেনাকাটার ইতিহাস
  দেখে ফেলত। গেস্ট `POST /track`-এ নম্বর **আর** ফোন দিয়ে দেখে।
- কুপনে `maxUsesPerUser: null` দিলে গেস্টও পায়; সীমা বসালে কুপন
  লগইন করা ক্রেতার জন্য সংরক্ষিত। গোনার জন্য `userId` লাগে, আর
  গেস্টের সেটা নেই — চুপচাপ উপেক্ষা করলে একজনই incognito খুলে পুরো
  ক্যাম্পেইন নিয়ে নিত।
- লগইনের পর গেস্ট কার্ট **হারায় না** — `POST /cart/merge` পরিমাণ
  যোগ করে মিশিয়ে দেয়। না থাকলে ক্রেতা কার্ট ভরে লগইন করার পর
  কার্ট খালি দেখত, ঠিক যখন সে কিনতে সবচেয়ে কাছে।
- গেস্টের **বড়** COD অর্ডার ঝুঁকির স্কোরে আসে (`GUEST_LARGE_ORDER`,
  ১৫ পয়েন্ট — নতুন অ্যাকাউন্টের চেয়ে কম, কারণ দরজাটা আমরা নিজেরাই
  খুলেছি)। ছোট অর্ডারে ধরা হয় না, নইলে অ্যাডমিন তালিকা পড়াই
  বন্ধ করে দিত।

**৫০৩টা API টেস্ট + ৩টা web টেস্ট সবুজ**, lint (তিন প্যাকেজেই),
coverage threshold আর build পরিষ্কার।

**এখন যা বাকি — তিনটাই মালিকের ব্যবস্থার অপেক্ষায়:**

| Phase | কী লাগবে |
|---|---|
| 08 Notifications | Redis সার্ভার (BullMQ) |
| 10 Courier | Steadfast/Pathao/RedX API key — তবে `manual` provider key ছাড়াই করা যায় |
| 12 Meta Pixel | Meta Pixel ID + access token |

তারপর frontend। সিদ্ধান্ত: আগে পুরো backend, UI তারপর।

**Phase 16, 17, 19-22** বাইরের কিছু ছাড়াই করা যায় — সার্চ, রিভিউ,
উইশলিস্ট, রিটার্ন/রিফান্ড, ব্যানার/CMS, SEO।


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
- **web-এর টেস্ট `npm run test:web` দিয়ে চালাও**, `npm run test -w @shop/web`
  দিয়ে নয়। Windows-এ npm workspace ছোট হাতের drive letter দেয় (`d:/…`),
  Vite তখন `d:/` আর `D:/` আলাদা ধরে নিজের runtime দুবার লোড করে আর
  `describe` undefined হয়ে যায় — টেস্ট ভাঙা মনে হয়, আসলে পথের সমস্যা
  (দেখো: `scripts/run-web-tests.mjs`)

## কোডের গুণমান — কী কী স্বয়ংক্রিয়ভাবে যাচাই হয়

| যাচাই | কোথায় | সীমা |
|---|---|---|
| TypeScript strict | তিন প্যাকেজেই | `noUncheckedIndexedAccess` সহ |
| `any` নিষেধ | eslint | error |
| কোড জটিলতা | eslint | `complexity` ১২, `max-depth` ৪ |
| ফাইল/ফাংশনের দৈর্ঘ্য | eslint | ৩৫০ / ৯০ লাইন (কমেন্ট বাদে) |
| প্যারামিটার সংখ্যা | eslint | ৫ |
| টেস্ট coverage | jest threshold | ৮০% statement, ৬০% branch |

**এখনকার coverage:** statement ৮৬%, branch ৬৮%, function ৮৭%।
সীমা তার একটু নিচে বসানো — আজকের কোড পাস করে, কিন্তু **অবনতি হলে
CI ভাঙবে**। সীমা বাড়াতে চাইলে `apps/api/package.json`-এর
`coverageThreshold`।

`packages/shared`-এ **আগে lint ছিল না** (api আর web-এর ছিল)। যোগ করার
পর প্রথম চালাতেই একটা অব্যবহৃত import ধরা পড়েছে। এখানেই টাকার হিসাব
আর ঝুঁকির স্কোর, তাই এটাই সবচেয়ে জরুরি জায়গা ছিল।
- **PATCH-এর schema `.partial()` দিয়ে বানাবে না** — Zod-এ `.partial()`
  মাঠ ঐচ্ছিক করে কিন্তু **`.default()` সরায় না**। ফলে `{ chargePaisa }`
  পাঠালেও বাকি মাঠে default বসে যায়: তালিকা `[]` হয়ে মুছে যায়,
  boolean `false` হয়ে যায়। Phase 14-এ এটা আসল bug হয়ে ধরা পড়েছে
  (চার্জ বদলাতে গেলে জেলার তালিকা মুছে যাচ্ছিল)। **সমাধান:** update
  schema আলাদা করে লেখো, প্রতিটা মাঠ `.optional()`, কোনো `.default()` নয়
- **seed ধরে নিয়ে কোড লিখবে না — CI seed চালায় না।** Phase 14-এ
  checkout-এ `500` এসেছিল শুধু CI-তে, লোকালে সব সবুজ। কারণ:
  `ShippingService.quote()` ইচ্ছাকৃতভাবে throw করে যখন কোনো zone
  মেলে না (চুপচাপ ০ চার্জ করার চেয়ে ভাঙা ভালো), কিন্তু default zone
  বসানো ছিল **শুধু seed-এ**। লোকাল DB seed করা, CI-র DB নয়।

  **এটা শুধু CI-র সমস্যা নয়** — এই কোড অন্য ব্যবসায়ীর কাছে বিক্রি
  হবে। সে `db:deploy` চালিয়ে দোকান খুললে **প্রথম অর্ডারেই** ভাঙত।
  **নিয়ম:** যে ডেটা ছাড়া অ্যাপ চলে না, সেটা migration-এ বসাও
  (`WHERE NOT EXISTS` দিয়ে, যাতে বারবার চালালে ডুপ্লিকেট না হয়);
  seed শুধু **সুবিধার** ডেটার জন্য — উদাহরণ পণ্য, ডেমো কুপন।

- **CI লোকালে হুবহু চালানোর উপায়** (অনুমান না করে):
  ```bash
  psql ... -c 'CREATE DATABASE ci_probe OWNER tshirt;'
  DATABASE_URL="...ci_probe..." npm run db:deploy -w @shop/api
  DATABASE_URL="...ci_probe..." npm run test:cov -w @shop/api
  ```
  seed **চালাবে না** — তাতেই CI-র অবস্থা মেলে। timezone বাগের জন্য
  এর সাথে `ALTER DATABASE ci_probe SET timezone TO 'UTC'` আর `TZ=UTC`।

- **e2e টেস্টে seed-এর নাম ধরে কিছু খুঁজবে না।** শিপিং টেস্ট
  `'ঢাকার বাইরে'` নাম ধরে default zone ফেরত বসাত; unseeded DB-তে
  সেটা না পেয়ে **চুপচাপ** বাদ পড়ত, আর DB-তে একটাও default থাকত না।
  ফলে পরের suite-গুলোর checkout ভাঙত — আর কারণটা অন্য ফাইলে দেখাত।
  **নিয়ম:** যা বদলেছ তা **id ধরে** ফেরাও, আর `afterAll`-এ ফেরানো
  সত্যিই হয়েছে কিনা যাচাই করো।
