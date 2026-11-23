# Phase 04 — Cart + Checkout + Order ID

**লক্ষ্য:** কাস্টমার কার্টে পণ্য রাখে, ঠিকানা দেয়, অর্ডার করে। প্রতিটা অর্ডার একটা **অদ্বিতীয় Order ID** পায় (`ORD-2026-1123-018`)। স্টক কমে, দাম সার্ভারে হিসাব হয়।

**Done মানে:** Verification পাস। এই phase-এ API; UI পরে।

---

## ১. ডিজাইন সিদ্ধান্ত

| প্রশ্ন | সিদ্ধান্ত | কেন |
|---|---|---|
| কার্ট কোথায়? | **DB-তে**, ইউজারপ্রতি একটা | লগইন করে অন্য ডিভাইসে গেলেও কার্ট থাকে |
| গেস্ট কার্ট? | না — চেকআউটে লগইন লাগবে | COD-এ ফোন যাচাই দরকার; গেস্ট অর্ডারে জবাবদিহি নেই |
| দাম কোথা থেকে? | **সবসময় DB থেকে** | ক্লায়েন্টের পাঠানো দাম বিশ্বাস করলে ১ টাকায় ফোন কেনা যায় |
| Order ID | `ORD-YYYY-MMDD-NNN`, দিনে রিসেট | পড়া ও বলা সহজ — ফোনে "ORD ডাবল জিরো আঠারো" |
| Race condition | `order_counter` টেবিল + `SELECT … FOR UPDATE` | দুটো অর্ডার একসাথে এলেও একই নম্বর পাবে না |
| স্টক কমানো | অর্ডারের **একই transaction**-এ, conditional update | নইলে oversell |
| অর্ডারের দাম | OrderItem-এ **কপি** করে রাখা | পরে প্রোডাক্টের দাম বদলালে পুরোনো ইনভয়েস বদলে যাবে না |

---

## ২. Schema

- `Cart` / `CartItem` — ইউজারপ্রতি একটা কার্ট, variant ধরে আইটেম
- `Address` — ইউজারের ঠিকানা, একাধিক, একটা default
- `Order` — orderNumber (unique), status, মোট টাকা, ঠিকানার **স্ন্যাপশট**
- `OrderItem` — variant-এর তথ্য ও দাম কপি করা
- `OrderStatusHistory` — কে কখন status বদলালো
- `OrderCounter` — `(year, month, day)` ধরে শেষ সিরিয়াল

**ঠিকানা কপি করার কারণ:** ইউজার পরে ঠিকানা বদলালে বা মুছলে পুরোনো অর্ডার কোথায় গিয়েছিল তা জানা থাকতে হবে।

---

## ৩. API

| Method | Path | কে | কী |
|---|---|---|---|
| GET | `/cart` | customer | নিজের কার্ট |
| POST | `/cart/items` | customer | যোগ (variantId + qty) |
| PATCH | `/cart/items/:id` | customer | পরিমাণ বদল |
| DELETE | `/cart/items/:id` | customer | বাদ |
| GET | `/addresses` | customer | নিজের ঠিকানা |
| POST | `/addresses` | customer | নতুন |
| POST | `/orders` | customer | **চেকআউট** |
| GET | `/orders` | customer | নিজের অর্ডার |
| GET | `/orders/:orderNumber` | customer | বিস্তারিত |

---

## Task Checklist

- [ ] 4.1 Schema + migration
- [ ] 4.2 **টেস্ট:** Order ID — concurrent, দিনে রিসেট, ডুপ্লিকেট নেই
- [ ] 4.3 `OrderNumberService` — FOR UPDATE transaction
- [ ] 4.4 **টেস্ট:** দাম সার্ভারে হিসাব, ক্লায়েন্টের দাম উপেক্ষিত
- [ ] 4.5 **টেস্ট:** স্টকের বেশি অর্ডার আটকায়, concurrent-এ oversell নেই
- [ ] 4.6 `CartService` + controller
- [ ] 4.7 `AddressService` + controller
- [ ] 4.8 `OrdersService` — চেকআউট transaction
- [ ] 4.9 **টেস্ট:** একজন অন্যের অর্ডার দেখতে পায় না
- [ ] Verification → PROGRESS ✅ → commit

---

## Verification

```bash
npm run test && npm run lint && npm run build
```

**হাতে:** দুই টার্মিনাল থেকে একসাথে চেকআউট → দুটো আলাদা Order ID, স্টক ঠিক।

---

## পরের Phase

`05-payments.md` — COD + manual payment + PDF invoice।
