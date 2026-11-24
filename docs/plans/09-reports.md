# Phase 09 — Reports + Analytics

**লক্ষ্য:** ব্যবসার আসল প্রশ্নগুলোর উত্তর DB থেকে বের করা — কত বিক্রি হলো,
কত টাকা হাতে এলো, কত বাকি, কোন পণ্য চলছে, কারা বারবার কিনছে।

**কেন এখন:** Phase 08 (Redis), 10 (কুরিয়ার key), 12 (Meta token) বাইরের
জিনিসে আটকা। Reports-এ বাইরের কিছু লাগে না — শুধু যে ডেটা ইতিমধ্যে জমছে
সেটাকে পড়া। Phase 04-07 থেকে অর্ডার, পেমেন্ট আর আইটেমের ডেটা তৈরি আছে।

**এই phase-এ নয়:** চার্ট বা UI (backend আগে), CSV/PDF export (UI-র সাথে
হবে), আর কোনো pre-aggregated summary table (নিচে "কেন নয়" দেখো)।

---

## ১. ডিজাইন সিদ্ধান্ত

| প্রশ্ন | সিদ্ধান্ত | কেন |
|---|---|---|
| Revenue মানে কী? | **দুটোই আলাদা**: ordered, collected, due | COD-তে অর্ডার হওয়া আর টাকা হাতে আসা এক নয় |
| Cancelled অর্ডার? | সব হিসাব থেকে **বাদ** | বাতিল অর্ডার বিক্রি নয়; ধরলে সংখ্যা ফুলে দেখাবে |
| কে দেখবে? | **শুধু `SUPER_ADMIN`** | টাকার হিসাব সংবেদনশীল। পরে role বাড়ানো সহজ — guard এক জায়গায় |
| তারিখ কোনটা ধরে? | `Order.createdAt` | "কবে অর্ডার হলো" — ব্যবসা এভাবেই ভাবে |
| সময় অঞ্চল | **লোকাল (Dhaka)** | `orderDateKey`-এর মতোই; "আজ" মানে ঢাকায় আজ |
| টাকার হিসাব | integer **paisa** | CLAUDE.md-র নিয়ম; float-এ পয়সা হারায় |
| Pre-aggregate table? | **না, এখন নয়** | নিচে দেখো |

### কেন pre-aggregated summary table এখন নয়

লোভনীয় শোনায়: রোজ রাতে একটা `DailySales` row লিখে রাখলে রিপোর্ট চটজলদি
আসত। কিন্তু:

1. **ডেটা এখনো ছোট** — কয়েক হাজার অর্ডারে index-সহ `GROUP BY` মিলিসেকেন্ডে
   চলে। সমস্যা না থাকা জিনিস সমাধান করা বাজে বিনিয়োগ।
2. **দুই জায়গায় সত্য থাকলে তারা আলাদা হয়ে যায়** — অর্ডার পরে বাতিল হলে বা
   পেমেন্ট void হলে summary row বাসি হয়ে যায়। তখন রিপোর্ট ভুল বলবে, আর
   ভুল সংখ্যা সংখ্যা না থাকার চেয়েও খারাপ (ভুল সিদ্ধান্ত হয়)।
3. **ফেরার পথ খোলা** — query ধীর হলে তখন cache বা materialized view বসানো
   যাবে। উল্টোটা (বাসি table থেকে সত্যে ফেরা) কঠিন।

যখন বসাতে হবে: অর্ডার লাখ ছাড়ালে, বা রিপোর্ট ১ সেকেন্ডের বেশি নিলে।

---

## ২. API endpoint

সবগুলো `GET`, সবগুলোতে `@Roles('SUPER_ADMIN')`, সবগুলো
`?from=YYYY-MM-DD&to=YYYY-MM-DD` নেয়।

| Endpoint | কী বলে |
|---|---|
| `GET /admin/reports/summary` | ordered / collected / due, অর্ডার সংখ্যা, গড় অর্ডার |
| `GET /admin/reports/sales` | দিন-ভিত্তিক সিরিজ (চার্টের জন্য) |
| `GET /admin/reports/best-sellers` | কোন পণ্য কত বিক্রি (পরিমাণ + টাকা) |
| `GET /admin/reports/status-breakdown` | কোন status-এ কতগুলো অর্ডার আটকে |
| `GET /admin/reports/repeat-customers` | একাধিকবার কিনেছে যারা |

### তারিখের নিয়ম

- `from`/`to` না দিলে **শেষ ৩০ দিন** — খালি স্ক্রিনের চেয়ে কিছু দেখানো ভালো
- `to` ওই দিনের **শেষ মুহূর্ত** পর্যন্ত ধরা হয়, নইলে আজকের অর্ডার বাদ পড়ত
- `from > to` হলে **400**, নীরবে উল্টে দেওয়া নয় — ভুল চুপচাপ ঢাকলে
  ইউজার ভুল সংখ্যা বিশ্বাস করে বসে
- সর্বোচ্চ **৩৭০ দিন** এক রিকোয়েস্টে — বছরের তুলনা চলবে, কিন্তু
  "সব সময়ের" scan দিয়ে DB আটকানো যাবে না

---

## ৩. টাকার তিন সংখ্যা

এই তিনটা আলাদা, আর এই পার্থক্যই COD ব্যবসার আসল কথা:

```
orderedPaisa    = অ-বাতিল অর্ডারের total-এর যোগফল
collectedPaisa  = RECEIVED payment-এর যোগফল (ওই অর্ডারগুলোর)
duePaisa        = ordered - collected   (কখনো ঋণাত্মক নয়)
```

`summarizePayments()` (Phase 05, `packages/shared`) একই যুক্তি এক অর্ডারের
জন্য করে। রিপোর্টে অনেক অর্ডারের যোগফল লাগে, তাই SQL-এ aggregate হবে —
কিন্তু **একই নিয়মে**: শুধু `RECEIVED`, বাতিল অর্ডার বাদ।

---

## Task Checklist

- [x] 9.1 **টেস্ট:** summary — ordered/collected/due আলাদা, বাতিল বাদ
- [x] 9.2 শেয়ার্ড schema + টাইপ (`packages/shared/src/schemas/report.ts`)
- [x] 9.3 `reports.service.ts` — summary + দিন-ভিত্তিক সিরিজ
- [x] 9.4 **টেস্ট:** best seller, status breakdown, repeat customer
- [x] 9.5 best seller / breakdown / repeat customer query
- [x] 9.6 **টেস্ট:** তারিখ যাচাই (উল্টো range 400, সীমা, ডিফল্ট ৩০ দিন)
- [x] 9.7 **টেস্ট:** `SUPER_ADMIN` ছাড়া কেউ ঢুকতে পারে না (403)
- [x] 9.8 `admin/` ফোল্ডার sub-folder-এ ভাগ (সিদ্ধান্ত: এই phase-এ)
- [x] 9.9 index যাচাই — query plan দেখে, অনুমানে নয়
- [x] Verification → PROGRESS ✅ → commit → merge → push → CI

---

## Verification

```bash
rm -rf packages/shared/dist   # CI-র মতো অবস্থা
npm run lint && npm run test && npm run build
```

---

## পরের Phase

`11-fraud-guard.md` — COD ঝুঁকি যাচাই। বাইরের কিছু লাগে না, তাই এটাই পরের।
