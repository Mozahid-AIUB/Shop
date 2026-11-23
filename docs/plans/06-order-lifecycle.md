# Phase 06 — Order Lifecycle + Tracking

**লক্ষ্য:** অর্ডার PENDING থেকে DELIVERED পর্যন্ত নিয়ম মেনে এগোবে। কাস্টমার লগইন ছাড়াই Order ID + ফোন দিয়ে অবস্থা দেখতে পারবে। অ্যাডমিন তালিকায় খুঁজে, ছেঁকে, পাতায় পাতায় দেখবে।

**Done মানে:** Verification পাস। API; UI পরে।

---

## ১. ডিজাইন সিদ্ধান্ত

| প্রশ্ন | সিদ্ধান্ত | কেন |
|---|---|---|
| Transition নিয়ম কোথায়? | `packages/shared`-এ `ORDER_STATUS_TRANSITIONS` (আগেই আছে) | API guard আর UI-র বাটন — দুই জায়গায় একই নিয়ম |
| অবৈধ transition? | **409**, কোনো নীরব উপেক্ষা নয় | অ্যাডমিন জানবে কেন হলো না |
| পেছনে যাওয়া? | না — `DELIVERED` বা `CANCELLED` থেকে কোথাও নয় | ডেলিভারি হওয়া অর্ডার আবার PENDING হলে হিসাব গুলিয়ে যায় |
| বাতিল কখন? | `PRINTED`-এর আগে পর্যন্ত | ছাপা হয়ে গেলে কাপড় নষ্ট, টাকা ফেরত আলাদা সিদ্ধান্ত |
| বাতিলে স্টক? | **ফেরত দেওয়া হবে** একই transaction-এ | নইলে বিক্রি না হওয়া পণ্য স্টকে নেই দেখাত |
| কে বদলাতে পারে? | `SUPER_ADMIN`, `ORDER_MANAGER`; `DESIGNER` শুধু DESIGN_CONFIRMED → IN_PRODUCTION | ডিজাইনার নিজের ধাপটাই এগোবে, ডেলিভারি নয় |
| কাস্টমার বাতিল? | শুধু `PENDING` অবস্থায়, নিজের অর্ডার | পরে স্টাফকে বলতে হবে |
| Public tracking কীভাবে? | Order ID **+ ফোন** দুটোই মিলতে হবে | শুধু ID দিলে নম্বর অনুমান করে অন্যের অর্ডার দেখা যেত |
| Tracking-এ কী দেখাবে? | status, তারিখ, আইটেম — **টাকার হিসাব নয়** | লগইন ছাড়া পাওনা-দেনা দেখানো ঠিক নয় |
| Rate limit? | Phase 13-এ, পুরো অ্যাপে একসাথে | এখন আলাদা করলে দুই জায়গায় নিয়ম থাকত |

**কেন ফোন নম্বর লাগবে:** Order ID-তে তারিখ আর সিরিয়াল আছে (`ORD-2026-1123-018`) — কেউ `001` থেকে গুনে সব অর্ডার দেখে ফেলতে পারত: কে কী কিনেছে, কোথায় থাকে। ফোন মিলিয়ে দেখা মানে অর্ডারটা যার, সে-ই দেখছে।

---

## ২. Schema

নতুন টেবিল **লাগবে না** — `OrderStatusHistory` Phase 04-এই আছে। শুধু history-তে `changedById` ব্যবহার শুরু হবে।

---

## ৩. API

| Method | Path | কে | কী |
|---|---|---|---|
| PATCH | `/admin/orders/:orderNumber/status` | staff | status বদল |
| GET | `/admin/orders` | staff | তালিকা — search, filter, pagination |
| GET | `/admin/orders/:orderNumber` | staff | বিস্তারিত |
| POST | `/orders/:orderNumber/cancel` | customer | নিজের PENDING অর্ডার বাতিল |
| POST | `/track` | **public** | Order ID + ফোন → অবস্থা |

---

## Task Checklist

- [x] 6.1 `ORDER_STATUS_TRANSITIONS` guard — shared-এ helper
- [x] 6.2 **টেস্ট:** অবৈধ transition 409, DELIVERED থেকে পেছনে নয়
- [x] 6.3 **টেস্ট:** বাতিলে স্টক ফেরত আসে, PRINTED-এর পর বাতিল হয় না
- [x] 6.4 **টেস্ট:** role — DESIGNER শুধু নিজের ধাপ, কাস্টমার শুধু নিজের PENDING
- [x] 6.5 **টেস্ট:** public tracking — ভুল ফোনে 404, টাকার হিসাব ফাঁস হয় না
- [x] 6.6 `OrderLifecycleService` + admin controller
- [x] 6.7 Admin order board — search (orderNumber/ফোন/নাম), filter (status, তারিখ), pagination
- [x] 6.8 Public `/track` endpoint
- [x] Verification → PROGRESS ✅ → commit

---

## Verification

```bash
npm run test -w @shop/api && npm run lint -w @shop/api && npm run build
```

---

## পরের Phase

`07-admin-panel.md` — production task, activity log, PDF invoice।
