# Phase 14-22 — Commerce Essentials (দোকান চালানোর বাকি অংশ)

**কেন এই phase-গুলো প্ল্যানে ছিল না:** মূল প্ল্যানের ১৩টা phase
**অর্ডার ব্যবস্থাপনায়** কেন্দ্রীভূত — পণ্য, কার্ট, অর্ডার, পেমেন্ট,
প্রোডাকশন, রিপোর্ট। সেগুলো দোকান *চালানোর* অংশ। কিন্তু দোকানে
*বিক্রি বাড়ানোর* অংশ (কুপন, রিভিউ, খোঁজা) আর *ক্রেতার সুবিধার*
অংশ (গেস্ট চেকআউট, উইশলিস্ট) বাদ পড়েছিল।

**এই নথির নিয়ম:** কিছু হার্ডকোড থাকবে না। সব নিয়ম DB বা `.env`-এ,
কারণ এই কোড অন্য ব্যবসায়ীদের কাছে বিক্রি হবে — তাদের শিপিং চার্জ,
ছাড়ের নিয়ম, এলাকা সব আলাদা হবে।

---

## ক্রম কেন এই রকম

```
14 Shipping ─────► 15 Coupon      (ফ্রি ডেলিভারি কুপনের জন্য শিপিং আগে লাগে)
16 Search
17 Review
18 Guest checkout ► 19 Wishlist   (গেস্ট cart-এর ধারণা উইশলিস্টেও লাগে)
20 Returns/Refund                 (Payment-এর REFUNDED row আগে থেকেই আছে)
21 Banner/CMS
22 SEO
```

শিপিং সবার আগে কারণ **এখন `shippingPaisa` হার্ডকোড `0`**
(`orders.service.ts:149`) — অর্থাৎ এখন সব ডেলিভারি ফ্রি, যা ব্যবসায়
সরাসরি লোকসান।

---

## Phase 14 — Shipping Rules

**সমস্যা:** `shippingPaisa = 0` হার্ডকোড। ঢাকায় ৬০, বাইরে ১২০ —
এই পার্থক্য কোডে নেই।

**Schema:**

```prisma
model ShippingZone {
  id             String  @id @default(cuid())
  name           String              // "ঢাকা সিটি", "ঢাকার বাইরে"
  /// কোন জেলাগুলো এই zone-এ — Order.shipDistrict-এর সাথে মেলে
  districts      String[]
  chargePaisa    Int
  /// এই অঙ্কের উপরে ফ্রি। null মানে কখনো ফ্রি নয়
  freeAbovePaisa Int?
  isDefault      Boolean @default(false)
  isActive       Boolean @default(true)
  sortOrder      Int     @default(0)
}
```

| সিদ্ধান্ত | কেন |
|---|---|
| জেলার তালিকা `String[]`, আলাদা table নয় | ৬৪ জেলা স্থির; join বাঁচে |
| একটা `isDefault` zone **বাধ্যতামূলক** | নতুন জেলা এলে চার্জ ০ হয়ে যেত |
| `freeAbovePaisa` zone-ভিত্তিক | ঢাকায় ১০০০+ ফ্রি, বাইরে ২০০০+ |
| চার্জ অর্ডারে **কপি** হবে | পরে চার্জ বদলালে পুরোনো ইনভয়েস বদলাবে না |

- [ ] 14.1 **টেস্ট:** zone বাছাই — জেলা মিললে সেটা, নইলে default
- [ ] 14.2 **টেস্ট:** free-above সীমা, আর কোনো zone না থাকলে কী হয়
- [ ] 14.3 Schema + migration + seed (ঢাকা/বাইরে)
- [ ] 14.4 `shipping.service.ts` — `quote(district, subtotal)`
- [ ] 14.5 checkout-এ যুক্ত (হার্ডকোড `0` সরানো)
- [ ] 14.6 Admin CRUD (`SUPER_ADMIN`)
- [ ] 14.7 Public `GET /shipping/quote` — কার্টে দেখাতে

---

## Phase 15 — Coupon + Campaign

**মালিকের চাওয়া:** "যখন যেমন ইচ্ছা তেমন অফার" — তাই নকশা
নমনীয় হতে হবে, নির্দিষ্ট অফারে বাঁধা নয়।

**Schema:**

```prisma
enum DiscountType {
  PERCENT          // ১০%
  FIXED            // ১০০ টাকা
  FREE_SHIPPING    // কুরিয়ার খরচ মাফ
}

model Coupon {
  id          String @id @default(cuid())
  code        String @unique          // SAVE50 — বড় হাতে সংরক্ষিত
  description String?

  type        DiscountType
  /// PERCENT-এ শতাংশ, FIXED-এ paisa, FREE_SHIPPING-এ অব্যবহৃত
  value       Int
  /// PERCENT-এর সর্বোচ্চ ছাড় — "১০% কিন্তু সর্বোচ্চ ২০০ টাকা"
  maxDiscountPaisa Int?

  minOrderPaisa Int @default(0)
  startsAt      DateTime?
  endsAt        DateTime?
  /// সব মিলিয়ে সর্বোচ্চ কতবার। null = সীমা নেই
  maxUses       Int?
  /// এক কাস্টমার কতবার
  maxUsesPerUser Int @default(1)
  isActive      Boolean @default(true)
}

/// কে কখন কোন কুপন ব্যবহার করল।
/// **`Coupon.usedCount` রাখা হয় না** — সেটা দুই জায়গায় সত্য হতো
/// আর গুনতে ভুল হলে মিলত না। এই table থেকে গোনা হয়।
model CouponRedemption {
  id        String   @id @default(cuid())
  couponId  String
  userId    String
  orderId   String   @unique
  /// কত ছাড় পেল — পরে কুপনের মান বদলালেও ইতিহাস ঠিক থাকে
  discountPaisa Int
  createdAt DateTime @default(now())

  @@unique([couponId, orderId])
  @@index([couponId, userId])
}
```

### যেখানে ভুল হলে টাকা যায় — এগুলোই আসল কাজ

| ঝুঁকি | প্রতিরোধ |
|---|---|
| একই কুপন বারবার (race) | redemption `@@unique`, একই transaction-এ গোনা |
| ছাড় > অর্ডারের মোট | `Math.min(discount, subtotal)` — total কখনো ঋণাত্মক নয় |
| ক্লায়েন্ট ছাড়ের অঙ্ক পাঠাচ্ছে | **কখনো ইনপুট থেকে নয়** — সবসময় সার্ভারে হিসাব |
| মেয়াদ শেষ কুপন | `startsAt`/`endsAt` checkout-এর সময় যাচাই |
| কুপন অনুমান করা | `/coupons/validate`-এ rate limit |

- [ ] 15.1 **টেস্ট:** তিন ধরনের ছাড়ের হিসাব (বিশুদ্ধ ফাংশন, shared-এ)
- [ ] 15.2 **টেস্ট:** ছাড় কখনো মোটের চেয়ে বেশি নয়, total ঋণাত্মক নয়
- [ ] 15.3 **টেস্ট:** সব শর্ত — মেয়াদ, সর্বোচ্চ ব্যবহার, প্রতি-ইউজার, ন্যূনতম অর্ডার
- [ ] 15.4 Schema + migration
- [ ] 15.5 `coupon.service.ts` — `validate()` আর `redeem()`
- [ ] 15.6 checkout-এ যুক্ত, **একই transaction-এ**
- [ ] 15.7 **টেস্ট:** একসাথে দুটো অর্ডারে একই শেষ কুপন — একটাই পাবে
- [ ] 15.8 Public `POST /coupons/validate` (rate limited)
- [ ] 15.9 Admin CRUD + কোন কুপন কতবার চলল

---

## Phase 16 — Product Search

Postgres-এর নিজের full-text search — Elasticsearch নয়, কারণ
আরেকটা সার্ভার মানে যে কোড কিনবে তার আরেকটা খরচ ও ঝামেলা।

| সিদ্ধান্ত | কেন |
|---|---|
| `tsvector` generated column + GIN index | DB নিজে রাখে, sync করার কিছু নেই |
| নাম > ক্যাটাগরি > বিবরণ (ওজন) | নামে মিললে সেটাই আগে আসা উচিত |
| বাংলা ও ইংরেজি দুটোই | `simple` config — stemming ছাড়া, বাংলার জন্য এটাই নিরাপদ |
| খালি ফলাফলে সাজেশন | "কিছু পাওয়া যায়নি" শেষ কথা নয় |

- [ ] 16.1 **টেস্ট:** নাম, ক্যাটাগরি, বিবরণে খোঁজা; ক্রম ঠিক
- [ ] 16.2 **টেস্ট:** বাংলা লেখায় খোঁজা
- [ ] 16.3 `tsvector` column + GIN index (migration)
- [ ] 16.4 `GET /products/search?q=` — pagination সহ
- [ ] 16.5 **টেস্ট:** খসড়া পণ্য ফলাফলে আসে না

---

## Phase 17 — Review + Rating

| সিদ্ধান্ত | কেন |
|---|---|
| **শুধু যে কিনেছে** লিখতে পারবে | ভুয়া রিভিউর সবচেয়ে বড় পথ বন্ধ |
| অ্যাডমিন অনুমোদন করবে (`isApproved`) | গালি বা স্প্যাম সরাসরি সাইটে যাবে না |
| প্রতি অর্ডার-আইটেমে একটাই রিভিউ | একজন ১০টা ৫-তারা দিতে পারবে না |
| গড় রেটিং **হিসাব করা হবে**, সংরক্ষণ নয় | রিভিউ মুছলে/অনুমোদন বদলালে বাসি হতো |
| অ্যাডমিন উত্তর দিতে পারবে | খারাপ রিভিউর জবাব দেওয়া ব্যবসার দরকার |

- [ ] 17.1 **টেস্ট:** যে কেনেনি সে রিভিউ দিতে পারে না (403)
- [ ] 17.2 **টেস্ট:** একই আইটেমে দুবার রিভিউ নয়
- [ ] 17.3 **টেস্ট:** অননুমোদিত রিভিউ public-এ দেখা যায় না
- [ ] 17.4 Schema + migration
- [ ] 17.5 `review.service.ts` + public/admin endpoint
- [ ] 17.6 পণ্যের গড় রেটিং তালিকা ও detail-এ

---

## Phase 18 — Guest Checkout

**এখন অ্যাকাউন্ট ছাড়া কেনা যায় না** — বাংলাদেশে এটা বড় বাধা,
অনেকে অ্যাকাউন্ট খুলতে চায় না।

| সিদ্ধান্ত | কেন |
|---|---|
| গেস্ট cart cookie-র token দিয়ে | লগইন ছাড়া cart রাখার একমাত্র উপায় |
| অর্ডারে `userId` nullable হবে | **বড় পরিবর্তন** — সব query দেখতে হবে |
| ফোন + অর্ডার নম্বরে ট্র্যাক | Phase 06-এ এটা আগেই আছে |
| গেস্ট পরে অ্যাকাউন্ট খুললে অর্ডার জুড়ে যাবে | একই ফোন/ইমেইল মিলিয়ে |

**ঝুঁকি:** `userId` nullable করলে ownership যাচাইয়ের প্রতিটা জায়গা
পুনরায় দেখতে হবে — নইলে গেস্টের অর্ডার অন্য কেউ দেখে ফেলবে।
তাই এই phase-এ টেস্ট সবচেয়ে বেশি।

- [ ] 18.1 **টেস্ট:** গেস্ট অর্ডার দিতে পারে
- [ ] 18.2 **টেস্ট:** এক গেস্টের token দিয়ে অন্যের cart দেখা যায় না
- [ ] 18.3 **টেস্ট:** লগইন করা ইউজারের অর্ডার গেস্ট দেখতে পায় না
- [ ] 18.4 Schema: `Order.userId` nullable + guest token
- [ ] 18.5 cart ও checkout-এ গেস্ট পথ
- [ ] 18.6 অ্যাকাউন্ট খোলার সময় পুরোনো অর্ডার জোড়া

---

## Phase 19 — Wishlist

- [ ] 19.1 **টেস্ট:** নিজের উইশলিস্টই দেখা যায়
- [ ] 19.2 Schema (`userId` + `variantId`, unique)
- [ ] 19.3 CRUD endpoint
- [ ] 19.4 **টেস্ট:** একই পণ্য দুবার যোগ করলে একটাই থাকে

---

## Phase 20 — Return + Refund

Payment-এ `REFUNDED` status আগে থেকেই আছে, কিন্তু "পণ্য ফেরত"
প্রক্রিয়া নেই — এখন শুধু অর্ডার বাতিল করা যায়।

| সিদ্ধান্ত | কেন |
|---|---|
| ফেরতের আলাদা status machine | অর্ডারের status-এ মেশালে দুটোই জটিল হতো |
| ফেরতের সময়সীমা `.env`-এ | দোকানভেদে আলাদা (৭ দিন / ১৫ দিন) |
| টাকা ফেরত = নতুন Payment row | ইতিহাস অক্ষত থাকে, মোছা হয় না |
| স্টক ফেরত **অ্যাডমিন দেখে সিদ্ধান্ত নেবে** | ছাপা শার্ট ফেরত এলে বিক্রিযোগ্য নয় |

- [ ] 20.1 **টেস্ট:** সময়সীমার পরে ফেরত চাওয়া যায় না
- [ ] 20.2 **টেস্ট:** রিফান্ডের পর পেমেন্টের হিসাব মেলে
- [ ] 20.3 Schema + migration
- [ ] 20.4 `return.service.ts` + endpoint
- [ ] 20.5 রিপোর্টে ফেরতের হার

---

## Phase 21 — Banner / CMS

হোমপেজের ছবি ও অফারের পোস্টার বদলাতে যেন কোড/deploy না লাগে।

- [ ] 21.1 Schema: `Banner` (ছবি, লিংক, ক্রম, সময়সীমা, সক্রিয়)
- [ ] 21.2 **টেস্ট:** মেয়াদ শেষ banner public-এ আসে না
- [ ] 21.3 Admin CRUD + public তালিকা
- [ ] 21.4 `StaticPage` — শর্তাবলী, গোপনীয়তা নীতি, যোগাযোগ

**নোট:** ছবি আপলোড MinIO-র উপর নির্ভর (এখনো নেই), তাই প্রথমে
URL হিসেবে রাখা হবে।

---

## Phase 22 — SEO

- [ ] 22.1 Schema: `metaTitle`, `metaDescription` (Product, Category)
- [ ] 22.2 `GET /sitemap-data` — web যেখান থেকে sitemap বানাবে
- [ ] 22.3 **টেস্ট:** খসড়া পণ্য sitemap-এ নেই
- [ ] 22.4 slug বদলালে পুরোনো slug redirect (`ProductSlugHistory`)

---

## প্রতিটা phase-এর Verification

```bash
rm -rf packages/shared/dist
npm run lint && npm run test:cov -w @shop/api && npm run test:web && npm run build
TZ=UTC npm run test -w @shop/api   # CI-র টাইমজোন
```

---

## যা এখনো বাইরের জিনিসে আটকা

| Phase | কী লাগবে |
|---|---|
| 08 Notifications | Redis (Memurai বসানো হচ্ছে) |
| 10 Courier | API key — তবে `manual` provider key ছাড়াই করা যায় |
| 12 Meta Pixel | Pixel ID + access token |
| ছবি আপলোড | MinIO বা S3 |
