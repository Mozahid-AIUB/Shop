# HANDOVER — ব্যাকএন্ডের অবস্থা

> ২৫ নভেম্বর ২০২৬। এই ফাইলটা **অবস্থার ছবি**, প্ল্যান নয়।
> প্ল্যান `PROGRESS.md`-এ, বিস্তারিত `BACKEND-TODO.md`-তে।

## এক নজরে

| | |
|---|---|
| শেষ commit | `f000fdf` — merge: phase 17 review and rating |
| `main` | পরিষ্কার, origin-এর সাথে মিল |
| CI | সবুজ |
| টেস্ট | **৫৬৬টা, সব পাস** (seed করা ও ফাঁকা DB দুটোতেই) |
| API endpoint | **৭৯টা**, ১৫টা controller |
| অর্ধসমাপ্ত কাজ | **নেই** |

## চালু করতে

```bash
git pull
npm install                      # package-lock বদলালে
npm run build -w @shop/shared    # এটা আগে চালাতেই হবে
npm run dev                      # api :4000 · web :3000
```

**`npm run build -w @shop/shared` কেন আগে:** web-এর টেস্ট
`@shop/shared`-কে TypeScript **source** ধরে চালায়, কিন্তু অন্য সবাই
`dist` ধরে। shared-এ নতুন কিছু যোগ করে rebuild না করলে web টেস্ট
`Cannot read properties of undefined (reading 'config')` দিয়ে ভাঙে, আর
error-টা ভুল জায়গায় (টেস্টের `describe` লাইনে) দেখায়। root-এর
`npm test` এখন নিজেই আগে build করে, তাই সেটাই নিরাপদ পথ।

## টেস্ট চালানো

```bash
npm test                         # সব (shared build + api + web)
npm run test -w @shop/api        # শুধু api — ৫৬৬টা
npm run test:web                 # শুধু web (`-w @shop/web` নয়, নিচে দেখো)
npm run lint
```

**`npm run test:web`, `npm run test -w @shop/web` নয়** — Windows-এ npm
workspace ছোট হাতের drive letter (`d:/`) দিয়ে cwd দেয়, আর Vite `d:/`
ও `D:/` কে দুটো আলাদা পথ ধরে নিজের runtime দুবার লোড করে।
`scripts/run-web-tests.mjs` drive letter ঠিক করে দেয়।

### CI-র অবস্থা হুবহু লোকালে

CI **seed চালায় না**, তাই seed-নির্ভর কোড শুধু CI-তে ভাঙে। মেলাতে:

```bash
psql ... -c 'CREATE DATABASE ci_probe OWNER tshirt;'
psql ... -c "ALTER DATABASE ci_probe SET timezone TO 'UTC';"
DATABASE_URL="...ci_probe..." TZ=UTC npm run db:deploy -w @shop/api
DATABASE_URL="...ci_probe..." TZ=UTC npm run test:cov -w @shop/api
```

## API — পুরো তালিকা

কোড থেকে বের করা (`@Controller` + method decorator), তাই এটা **আসল
অবস্থা**, ইচ্ছা নয়।

- **খোলা** = লগইন লাগে না
- **লগইন ঐচ্ছিক** = গেস্টও পারে, `x-guest-token` header দিয়ে
- **লগইন** = টোকেন লাগে, যেকোনো role
- role-এর নাম = শুধু ওই role-গুলো

| Endpoint | কে পারে |
|---|---|
| `GET /addresses` | লগইন |
| `POST /addresses` | লগইন |
| `PATCH /addresses/:id` | লগইন |
| `DELETE /addresses/:id` | লগইন |
| `GET /admin/activity` | SUPER_ADMIN |
| `POST /admin/categories` | SUPER_ADMIN, ORDER_MANAGER |
| `PATCH /admin/categories/:id` | SUPER_ADMIN, ORDER_MANAGER |
| `DELETE /admin/categories/:id` | SUPER_ADMIN |
| `GET /admin/coupons` | SUPER_ADMIN |
| `POST /admin/coupons` | SUPER_ADMIN |
| `PATCH /admin/coupons/:id` | SUPER_ADMIN |
| `DELETE /admin/coupons/:id` | SUPER_ADMIN |
| `GET /admin/coupons/:id/usage` | SUPER_ADMIN |
| `GET /admin/couriers` | SUPER_ADMIN |
| `POST /admin/couriers` | SUPER_ADMIN |
| `PATCH /admin/couriers/:id` | SUPER_ADMIN |
| `DELETE /admin/couriers/:id` | SUPER_ADMIN |
| `GET /admin/couriers/supported` | SUPER_ADMIN |
| `GET /admin/orders` | SUPER_ADMIN, ORDER_MANAGER, DESIGNER |
| `GET /admin/orders/:orderNumber` | SUPER_ADMIN, ORDER_MANAGER, DESIGNER |
| `POST /admin/orders/:orderNumber/dispatch` | SUPER_ADMIN, ORDER_MANAGER |
| `GET /admin/orders/:orderNumber/invoice` | SUPER_ADMIN, ORDER_MANAGER, ACCOUNTANT |
| `GET /admin/orders/:orderNumber/payments` | SUPER_ADMIN, ACCOUNTANT, ORDER_MANAGER |
| `POST /admin/orders/:orderNumber/payments` | SUPER_ADMIN, ACCOUNTANT, ORDER_MANAGER |
| `PATCH /admin/orders/:orderNumber/status` | SUPER_ADMIN, ORDER_MANAGER, DESIGNER |
| `POST /admin/orders/:orderNumber/tasks` | SUPER_ADMIN, ORDER_MANAGER |
| `POST /admin/payments/:id/void` | SUPER_ADMIN, ACCOUNTANT, ORDER_MANAGER |
| `POST /admin/products` | SUPER_ADMIN, ORDER_MANAGER |
| `GET /admin/products/:id` | SUPER_ADMIN, ORDER_MANAGER |
| `PATCH /admin/products/:id` | SUPER_ADMIN, ORDER_MANAGER |
| `DELETE /admin/products/:id` | SUPER_ADMIN |
| `GET /admin/reports/best-sellers` | SUPER_ADMIN |
| `GET /admin/reports/repeat-customers` | SUPER_ADMIN |
| `GET /admin/reports/sales` | SUPER_ADMIN |
| `GET /admin/reports/status-breakdown` | SUPER_ADMIN |
| `GET /admin/reports/summary` | SUPER_ADMIN |
| `GET /admin/reviews` | SUPER_ADMIN, ORDER_MANAGER |
| `PATCH /admin/reviews/:id/moderation` | SUPER_ADMIN, ORDER_MANAGER |
| `PATCH /admin/reviews/:id/reply` | SUPER_ADMIN, ORDER_MANAGER |
| `PATCH /admin/shipments/:id/status` | SUPER_ADMIN, ORDER_MANAGER |
| `GET /admin/shipping-zones` | SUPER_ADMIN |
| `POST /admin/shipping-zones` | SUPER_ADMIN |
| `PATCH /admin/shipping-zones/:id` | SUPER_ADMIN |
| `DELETE /admin/shipping-zones/:id` | SUPER_ADMIN |
| `GET /admin/tasks` | SUPER_ADMIN, ORDER_MANAGER, DESIGNER |
| `PATCH /admin/tasks/:id` | SUPER_ADMIN, ORDER_MANAGER, DESIGNER |
| `PATCH /admin/tasks/:id/assign` | SUPER_ADMIN, ORDER_MANAGER |
| `PATCH /admin/variants/:id/stock` | SUPER_ADMIN, ORDER_MANAGER |
| `GET /auth/admin-check` | SUPER_ADMIN, ORDER_MANAGER, DESIGNER, ACCOUNTANT |
| `POST /auth/login` | খোলা |
| `POST /auth/logout` | খোলা |
| `GET /auth/me` | লগইন |
| `POST /auth/refresh` | খোলা |
| `POST /auth/register` | খোলা |
| `GET /cart` | লগইন ঐচ্ছিক |
| `POST /cart/guest` | লগইন ঐচ্ছিক |
| `POST /cart/items` | লগইন ঐচ্ছিক |
| `PATCH /cart/items/:id` | লগইন ঐচ্ছিক |
| `DELETE /cart/items/:id` | লগইন ঐচ্ছিক |
| `POST /cart/merge` | লগইন |
| `GET /categories` | খোলা |
| `POST /coupons/validate` | লগইন ঐচ্ছিক |
| `POST /courier-webhook/:courier` | খোলা |
| `GET /health` | খোলা |
| `GET /orders` | লগইন |
| `POST /orders` | লগইন ঐচ্ছিক |
| `GET /orders/:orderNumber` | লগইন |
| `POST /orders/:orderNumber/cancel` | লগইন |
| `GET /orders/:orderNumber/payments` | লগইন |
| `GET /products` | খোলা |
| `GET /products/:slug` | খোলা |
| `GET /products/:slug/reviews` | খোলা |
| `GET /products/search` | খোলা |
| `POST /reviews` | লগইন |
| `PATCH /reviews/:id` | লগইন |
| `DELETE /reviews/:id` | লগইন |
| `GET /reviews/mine` | লগইন |
| `GET /shipping/quote` | খোলা |
| `POST /track` | খোলা |

## যা এখনো নেই

| Phase | কী | কেন আটকে |
|---|---|---|
| ১৯ | উইশলিস্ট | —, যেকোনো সময় ধরা যায় |
| ২০ | রিটার্ন ও রিফান্ড | —, **সুপারিশ: এটা আগে** |
| ২১ | ব্যানার / CMS | — |
| ২২ | SEO (sitemap, meta) | — |
| ০৮ | নোটিফিকেশন (SMS/ইমেইল) | **Redis/Memurai ইনস্টল দরকার** (elevated PowerShell) |
| ১২ | Meta Pixel + CAPI | **Pixel ID + access token দরকার** |

**কেন ২০ আগে:** এখন পণ্য ফেরত এলে বা টাকা ফেরত দিলে সিস্টেমে লেখার
জায়গাই নেই। ফলে বিক্রির রিপোর্ট **বেশি** দেখায় (ফেরানো টাকাও আয়ে
গোনা হয়) আর স্টক ভুল থাকে। `PaymentStatus`-এ `REFUNDED` আছে, কিন্তু
**কে কখন কেন** দিল তার রেকর্ড নেই। আর Phase 10-এ কুরিয়ারের
`RETURNED` অবস্থা ইচ্ছাকৃতভাবে কোনো order status-এ map করা হয়নি
("ফেরত একটা মানুষের সিদ্ধান্ত") — ওই সুতোটা এখনো ঝুলছে।

**frontend:** মালিকের নির্দেশে সব backend শেষ হওয়ার আগে ধরা হবে না।
`apps/web`-এ এখন শুধু Phase 01-এর health card।

## মালিকের জন্য বাকি কাজ

**Steadfast-এর API key দুটো revoke করে নতুন নিতে হবে।** সেগুলো চ্যাটে
পাঠানো হয়েছিল, তাই আর গোপন নয় (কোডে বা কোনো ফাইলে লেখা হয়নি)।
Steadfast-এর "Your API keys" থেকে reissue করে নতুন key **অ্যাডমিন
প্যানেল থেকে** বসাতে হবে — `.env`-এ নয়। কুরিয়ারের key UI থেকে বসে আর
DB-তে AES-256-GCM দিয়ে এনক্রিপ্ট হয়; `.env`-এ শুধু একটা master key
(`COURIER_SECRET_KEY`)।

## যে ভুলগুলো আগে হয়েছে, আবার করলে সময় যাবে

1. **`.partial()` ব্যবহার করবে না** Zod update schema-তে — সেটা
   `.default()` রেখে দেয়, তাই না-পাঠানো মাঠ চুপচাপ ডিফল্টে বসে যায়।
   Phase 14-এ এটা আসল bug হয়েছিল (চার্জ বদলাতে গেলে জেলার তালিকা
   মুছে যাচ্ছিল)। প্রতিটা মাঠ আলাদা করে `.optional()` লেখো।
2. **seed ধরে কোড লিখবে না** — CI seed চালায় না, আর যে ব্যবসায়ী
   `db:deploy` চালিয়ে দোকান খুলবে সেও না। অ্যাপ যা ছাড়া চলে না তা
   **migration-এ** বসাও, `WHERE NOT EXISTS` দিয়ে।
3. **`tsvector` / `pg_trgm` বাংলায় কাজ করে না** — Postgres-এর parser
   বাংলা অক্ষরকে ফাঁকা জায়গা ধরে (যাচাই করা)। সার্চ ILIKE-এ বানানো,
   "অপ্টিমাইজ" করতে গিয়ে ফেরাবে না; বাংলা টেস্টগুলো পাহারায় আছে।
4. **`prisma migrate dev` এখানে চলে না** (non-interactive)। পথ:
   `migrate diff --from-schema <পুরোনো> --to-schema <নতুন> --script`
   দিয়ে SQL বের করে হাতে migration folder বানাও, তারপর
   `migrate deploy`। **`apps/api` থেকে চালাতে হয়**, কারণ
   `prisma.config.ts` ওখানে আর পথগুলো relative।
5. **`Order.userId` nullable** (গেস্ট অর্ডার)। `where: { userId }`-এ
   `undefined` গেলে Prisma শর্তটাই বাদ দেয় আর **সব** অর্ডার ফেরে।
   `CartOwner` discriminated union এজন্যই আছে — ব্যবহার করো।
6. **রিপোর্টে `AT TIME ZONE` দুবার** — আগে `'UTC'`, তারপর
   `'Asia/Dhaka'`। একবার দিলে ফল DB-র নিজের timezone সেটিংয়ের উপর
   নির্ভর করে, আর CI (UTC) ও এই মেশিন আলাদা উত্তর দেয়। CI তিনবার
   ভেঙেছিল।
7. **ফাইল ৩৫০ লাইনের বেশি হলে lint ভাঙে।** select আর view টাইপ
   আলাদা ফাইলে সরাও (`order-views.ts`, `product-views.ts` যেমন)।
8. **repo-র ফাইল CRLF** — heredoc দিয়ে বাংলা লেখা replace করতে গেলে
   মেলে না। `Edit`/`Write` ব্যবহার করো, বা line index ধরে বদলাও।
