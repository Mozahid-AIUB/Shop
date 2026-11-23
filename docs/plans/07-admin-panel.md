# Phase 07 — Admin Panel (production + audit)

**লক্ষ্য:** অর্ডার এলে কে কী কাজ করবে তা ভাগ হবে, আর অ্যাডমিনে কে কী বদলালো তার হিসাব থাকবে।

**Done মানে:** Verification পাস। API; UI পরে।

---

## ০. এই phase-এর সিদ্ধান্ত (প্ল্যান থেকে সরানো হয়েছে)

| প্ল্যানে ছিল | এখন | কেন |
|---|---|---|
| 7.2 print-ready ফাইল আপলোড | **বাদ** — MinIO বসার পর, Phase 08-এর সাথে | আপলোড পুরো প্রোডাক্টের সবচেয়ে ঝুঁকিপূর্ণ জায়গা (magic byte, SVG XSS, presigned URL)। local disk-এ করে পরে S3-এ সরালে দুবার লিখতে হবে, আর মাঝের সময়টায় অর্ধেক-নিরাপদ কোড লাইভে থাকবে |
| `ProductionTask` ছাপার কাজে নির্দিষ্ট | **সাধারণ কাজের তালিকা** | দোকান এখন যেকোনো পণ্য বিক্রি করে। ছাপা, প্যাকিং, QC — সব একই টেবিলে ধরবে, `kind` দিয়ে আলাদা হবে |
| PDF invoice (Phase 05 থেকে সরানো) | **এখানে** | ইনভয়েসে অর্ডার + পেমেন্ট দুটোই লাগে, দুটোই এখন আছে |

---

## ১. ডিজাইন সিদ্ধান্ত

| প্রশ্ন | সিদ্ধান্ত | কেন |
|---|---|---|
| কাজ কার সাথে জোড়া? | `Order`-এর সাথে, একাধিক কাজ | এক অর্ডারে ছাপা + প্যাকিং আলাদা লোক করতে পারে |
| কাজের ধরন? | `kind` enum — `DESIGN`, `PRINT`, `PACKING`, `QC`, `OTHER` | যেকোনো পণ্যে খাটে, নতুন ধরন যোগ করা সহজ |
| কাকে assign? | staff user, null মানে এখনো কেউ নেয়নি | কাজ তৈরি আর বিলি আলাদা ঘটনা |
| কাজের অবস্থা? | `PENDING` → `IN_PROGRESS` → `DONE`, বা `BLOCKED` | কম রাখা হলো; বেশি স্তর মানে কেউ আপডেট করবে না |
| কাজ মুছবে? | না — `CANCELLED` | কে কী করেছিল সেটা হারানো যাবে না |
| Activity log কী ধরবে? | অ্যাডমিনের **লেখার** কাজ — status বদল, পেমেন্ট, প্রোডাক্ট, assign | পড়া ধরলে log-ই সবচেয়ে বড় টেবিল হয়ে যেত |
| কে log দেখবে? | `SUPER_ADMIN` only | log-এ কে কী করেছে থাকে — এটা কর্মীদের উপর নজরদারির তথ্য |
| Log কি মোছা যাবে? | না, কোনো API নেই | অডিট ট্রেইল মোছা গেলে সেটা অডিট নয় |
| ইনভয়েস কোথায় তৈরি? | সার্ভারে, অর্ডার + পেমেন্ট থেকে | ক্লায়েন্টে বানালে অঙ্ক বদলে দেওয়া যেত |

**কেন `ActivityLog` আর `OrderStatusHistory` আলাদা:** history শুধু অর্ডারের status-এর, আর কাস্টমারকেও দেখানো হয়। ActivityLog সব ধরনের অ্যাডমিন কাজের, আর শুধু ভেতরের লোকের জন্য। এক টেবিলে মেশালে কাস্টমারকে দেখানোর সময় ছেঁকে বের করতে হতো — একবার ভুল করলেই ভেতরের তথ্য ফাঁস।

---

## ২. Schema

- `ProductionTask` — `orderId`, `kind`, `status`, `assignedToId`, `note`, `dueAt`
- `ProductionTaskStatus` enum — `PENDING`, `IN_PROGRESS`, `DONE`, `BLOCKED`, `CANCELLED`
- `ProductionTaskKind` enum — `DESIGN`, `PRINT`, `PACKING`, `QC`, `OTHER`
- `ActivityLog` — `actorId`, `action`, `entityType`, `entityId`, `summary`, `createdAt`

---

## ৩. API

| Method | Path | কে | কী |
|---|---|---|---|
| GET | `/admin/tasks` | staff | কাজের তালিকা — filter, pagination |
| POST | `/admin/orders/:orderNumber/tasks` | SUPER_ADMIN, ORDER_MANAGER | কাজ তৈরি |
| PATCH | `/admin/tasks/:id` | staff (নিজের কাজ) | status/note বদল |
| PATCH | `/admin/tasks/:id/assign` | SUPER_ADMIN, ORDER_MANAGER | কাকে দেওয়া হবে |
| GET | `/admin/activity` | SUPER_ADMIN | অডিট লগ |
| GET | `/admin/orders/:orderNumber/invoice` | staff | ইনভয়েসের ডেটা (PDF পরে UI-তে) |

---

## Task Checklist

- [x] 7.1 Schema + migration
- [x] 7.2 **টেস্ট:** কাজ তৈরি, assign, status বদল
- [x] 7.3 **টেস্ট:** role — DESIGNER নিজের কাজ বদলাতে পারে, অন্যের নয়; log শুধু SUPER_ADMIN
- [x] 7.4 **টেস্ট:** activity log লেখা হয় — status বদল ও পেমেন্টে
- [x] 7.5 `ProductionTasksService` + controller
- [x] 7.6 `ActivityLogService` — অন্য service থেকে ডাকা যায়
- [x] 7.7 ইনভয়েস ডেটা endpoint (অর্ডার + আইটেম + পেমেন্ট + due)
- [x] Verification → PROGRESS ✅ → commit → push

**PDF রেন্ডার UI-তে** — সার্ভারে PDF বানাতে headless Chrome লাগে, সেটা ভারী। ডেটা API দিলে web থেকে ছাপা যাবে।

---

## Verification

```bash
npm run test -w @shop/api && npm run lint -w @shop/api && npm run build
```

**CI-র মতো করে:** `rm -rf packages/shared/dist` করে তারপর চালাও।

---

## পরের Phase

`08-notifications.md` — Redis + BullMQ + SMS/Email। **Redis বসাতে হবে আগে।**
