# Phase 05 — Payments (COD + manual)

**লক্ষ্য:** অর্ডারের টাকা কতটা এলো, কতটা বাকি — সেটা হিসাব রাখা। COD-এ কুরিয়ার টাকা তুলে আনে, বিকাশে কাস্টমার পাঠায় আর অ্যাডমিন হাতে লিখে দেয়।

**Done মানে:** Verification পাস। এই phase-এ API; UI পরে।

**গেটওয়ে নয় এখন** — bKash/SSLCommerz-এর আসল integration পরে। `PaymentProvider` interface তৈরি থাকবে যাতে তখন শুধু একটা adapter যোগ করলেই চলে।

---

## ১. ডিজাইন সিদ্ধান্ত

| প্রশ্ন | সিদ্ধান্ত | কেন |
|---|---|---|
| টাকার হিসাব কোথায়? | `Payment` row-গুলোর **যোগফল**, `Order`-এ জমানো নয় | জমানো অঙ্ক আর row একসাথে ভুল হলে কোনটা সত্যি তা বোঝা যায় না |
| আংশিক পেমেন্ট? | **হ্যাঁ** — অগ্রিম ৫০০, বাকি ডেলিভারিতে | বাংলাদেশে কাস্টম অর্ডারে অগ্রিম নেওয়া স্বাভাবিক |
| বেশি টাকা এলে? | আটকাবে — due-র বেশি নেওয়া যাবে না | নইলে রিফান্ডের হিসাব গুলিয়ে যায়; বেশি এলে আলাদা refund row |
| `paymentStatus` কে বদলায়? | পেমেন্ট যোগ/বাদের সময় **সার্ভার নিজে** | হাতে বদলাতে দিলে UNPAID অর্ডার PAID দেখিয়ে পণ্য চলে যেত |
| কে পেমেন্ট লিখতে পারে? | `SUPER_ADMIN`, `ACCOUNTANT`, `ORDER_MANAGER` | DESIGNER-এর টাকার হিসাবে কাজ নেই |
| পেমেন্ট মোছা? | row মোছা **নয়** — void করা হয় | টাকার হিসাবে মুছে ফেলা মানে অডিট ট্রেইল হারানো |
| COD কখন PAID? | কুরিয়ার টাকা দিলে, অ্যাডমিন লিখলে | ডেলিভারি হওয়া আর টাকা হাতে আসা এক জিনিস নয় |

**কেন যোগফল, জমানো অঙ্ক নয়:** `Order.paidPaisa` রাখলে একটা পেমেন্ট ভুল হলে ওই কলামও ঠিক করতে হতো, আর দুটো একসাথে ভুল হলে মেলানো অসম্ভব। row-ই একমাত্র সত্য, `paymentStatus` শুধু দ্রুত ফিল্টারের জন্য রাখা সারাংশ।

---

## ২. Schema

- `Payment` — অর্ডারপ্রতি একাধিক, `amountPaisa`, `method`, `status`, `reference` (বিকাশের TrxID), কে লিখলো
- `PaymentMethod` enum — `COD`, `BKASH_MANUAL`, `NAGAD_MANUAL`, `BANK_TRANSFER`, `CASH`
- `PaymentRecordStatus` enum — `RECEIVED`, `VOIDED`, `REFUNDED`

`Order.paymentStatus` আগেই আছে (`UNPAID`/`PARTIAL`/`PAID`/`REFUNDED`) — পেমেন্ট বদলালে সার্ভার সেটা নতুন করে হিসাব করবে।

---

## ৩. API

| Method | Path | কে | কী |
|---|---|---|---|
| GET | `/orders/:orderNumber/payments` | customer (নিজের) | নিজের অর্ডারের পেমেন্ট |
| GET | `/admin/orders/:orderNumber/payments` | staff | যেকোনো অর্ডারের |
| POST | `/admin/orders/:orderNumber/payments` | staff | পেমেন্ট লেখা |
| POST | `/admin/payments/:id/void` | staff | ভুল এন্ট্রি বাতিল |

---

## Task Checklist

- [x] 5.1 Schema + migration
- [x] 5.2 **টেস্ট:** আংশিক পেমেন্ট → `PARTIAL`, পুরো → `PAID`
- [x] 5.3 **টেস্ট:** due-র বেশি নেওয়া আটকায়, integer paisa-তে হিসাব
- [x] 5.4 **টেস্ট:** void করলে due ফিরে আসে, status আবার হিসাব হয়
- [x] 5.5 **টেস্ট:** role — DESIGNER পেমেন্ট লিখতে পারে না, কাস্টমার অন্যের পেমেন্ট দেখে না
- [x] 5.6 `PaymentsService` + controller
- [x] 5.7 `PaymentProvider` interface + `ManualProvider` (গেটওয়ের জায়গা রাখা)
- [x] Verification → PROGRESS ✅ → commit

**PDF invoice পরে** — Phase 07-এর অ্যাডমিন প্যানেলের সাথে, যখন UI থাকবে।

---

## Verification

```bash
npm run test -w @shop/api && npm run lint -w @shop/api && npm run build
```

---

## পরের Phase

`06-order-lifecycle.md` — status state machine + public order tracking।
