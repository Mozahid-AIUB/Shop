# Phase 03 — Catalog + Inventory

**লক্ষ্য:** অ্যাডমিন যেকোনো ধরনের পণ্য যোগ করতে পারে — পোশাক, ইলেকট্রনিক্স, খাবার, বই — প্রতিটার নিজস্ব attribute সহ। Storefront-এ ক্যাটালগ, ফিল্টার আর product detail page কাজ করে। স্টক কখনো negative হয় না।

**Done মানে:** Verification-এর সব কমান্ড পাস। এই phase-এ API + schema; storefront UI-র ন্যূনতম অংশ (list + detail) থাকবে, সাজানো Phase 07-এ।

---

## ১. ডিজাইন সিদ্ধান্ত

| প্রশ্ন | সিদ্ধান্ত | কেন |
|---|---|---|
| যেকোনো পণ্য কীভাবে? | `Product` + **`ProductAttribute`** (key-value) | জামার "fabric", ফোনের "RAM" — আলাদা টেবিল না বানিয়ে একই কাঠামোয় |
| Variant | `ProductVariant` — নিজের SKU, দাম, স্টক | রং×সাইজ, বা ১২৮GB/২৫৬GB — যা-ই হোক |
| Variant-এর বিকল্প | `VariantOption` (name + value) | "Color: Red", "Size: XL" — নমনীয়, হার্ডকোড নয় |
| দাম | **integer paisa**, `Int` | float-এ ০.১+০.২ ≠ ০.৩; টাকায় সেটা চলে না |
| ক্যাটাগরি | self-relation (parent/child) | গাছ — "ইলেকট্রনিক্স > ফোন > স্মার্টফোন" |
| স্টক কমানো | DB-তে conditional update | `SELECT` করে `UPDATE` করলে race condition; শর্তসহ এক query-তে |
| ছবি | `ProductImage` — URL + sort order | একাধিক ছবি, ক্রম বদলানো যায় |
| খোঁজা | Postgres GIN index + `tsvector` | `LIKE '%...%'` বড় ডেটায় টেবিল স্ক্যান করে |

**Efficiency-র নিয়ম এই phase-এ:**
- তালিকায় কখনো `include` দিয়ে সব variant টানা হবে না — **N+1 নিষেধ**, `select` দিয়ে যা লাগে তাই
- pagination **cursor-ভিত্তিক**, `skip/take` নয় (বড় offset-এ Postgres ধীর)
- প্রতিটা filter-এর কলামে index থাকতে হবে, টেস্টে `EXPLAIN` দিয়ে প্রমাণ

---

## ২. Schema

```prisma
model Category {
  id       String     @id @default(cuid())
  name     String
  slug     String     @unique
  parentId String?
  parent   Category?  @relation("CategoryTree", fields: [parentId], references: [id])
  children Category[] @relation("CategoryTree")
  products Product[]

  @@index([parentId])
  @@map("categories")
}

model Product {
  id          String   @id @default(cuid())
  name        String
  slug        String   @unique
  description String?
  categoryId  String
  /// খসড়া প্রোডাক্ট storefront-এ দেখা যাবে না
  isPublished Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  category   Category           @relation(fields: [categoryId], references: [id])
  variants   ProductVariant[]
  images     ProductImage[]
  attributes ProductAttribute[]

  @@index([categoryId, isPublished])
  @@index([isPublished, createdAt])
  @@map("products")
}

model ProductVariant {
  id        String @id @default(cuid())
  productId String
  sku       String @unique
  /// দাম paisa-তে — ১০০ টাকা = 10000
  pricePaisa Int
  /// আগের দাম (ছাড় দেখাতে), না থাকলে null
  comparePricePaisa Int?
  stock     Int    @default(0)
  isActive  Boolean @default(true)

  product Product         @relation(fields: [productId], references: [id], onDelete: Cascade)
  options VariantOption[]

  @@index([productId, isActive])
  @@map("product_variants")
}

model VariantOption {
  id        String @id @default(cuid())
  variantId String
  /// "Color", "Size", "Storage" — যা খুশি
  name      String
  value     String

  variant ProductVariant @relation(fields: [variantId], references: [id], onDelete: Cascade)

  @@unique([variantId, name])
  @@index([name, value])
  @@map("variant_options")
}

model ProductAttribute {
  id        String @id @default(cuid())
  productId String
  name      String
  value     String

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([productId, name])
  @@map("product_attributes")
}

model ProductImage {
  id        String @id @default(cuid())
  productId String
  url       String
  alt       String?
  sortOrder Int     @default(0)

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@index([productId, sortOrder])
  @@map("product_images")
}
```

---

## ৩. API

| Method | Path | কে | কী করে |
|---|---|---|---|
| GET | `/products` | public | তালিকা — filter, cursor pagination |
| GET | `/products/:slug` | public | এক প্রোডাক্ট, variant + ছবি সহ |
| GET | `/categories` | public | গাছ |
| POST | `/admin/products` | staff | তৈরি (variant + attribute একসাথে) |
| PATCH | `/admin/products/:id` | staff | সম্পাদনা |
| DELETE | `/admin/products/:id` | SUPER_ADMIN | মুছে ফেলা |
| PATCH | `/admin/variants/:id/stock` | staff | স্টক সমন্বয় |

**নিরাপত্তা:**
- দাম **কখনো** ক্লায়েন্ট থেকে নেওয়া হবে না অর্ডারের সময় — DB থেকেই পড়া হবে (Phase 04)
- `isPublished: false` প্রোডাক্ট public API-তে আসবে না, এমনকি slug দিয়েও

---

## Task Checklist

- [ ] 3.1 Schema + migration
- [ ] 3.2 **টেস্ট:** CRUD, শুধু staff পারে, customer 403
- [ ] 3.3 **টেস্ট:** স্টক negative হয় না, concurrent decrement-এ oversell নেই
- [ ] 3.4 **টেস্ট:** দাম integer paisa — float দিলে 400
- [ ] 3.5 **টেস্ট:** unpublished প্রোডাক্ট public API-তে নেই
- [ ] 3.6 `CategoriesService` + controller
- [ ] 3.7 `ProductsService` (admin CRUD) + controller
- [ ] 3.8 Public catalog API — filter, cursor pagination, search
- [ ] 3.9 **টেস্ট:** N+1 নেই — তালিকায় query সংখ্যা গুনে দেখা
- [ ] 3.10 Storefront — ক্যাটালগ পেজ + PDP (ন্যূনতম)
- [ ] 3.11 Seed — কয়েকটা নমুনা প্রোডাক্ট (ভিন্ন ভিন্ন ধরনের)
- [ ] Verification পাস → PROGRESS ✅ → commit

---

## Verification

```bash
npm run db:migrate
npm run db:seed
npm run dev

curl localhost:4000/products                      # তালিকা, unpublished নেই
curl localhost:4000/products?categorySlug=phones  # filter
curl localhost:4000/categories                    # গাছ

# staff ছাড়া তৈরি করা যায় না
curl -X POST localhost:4000/admin/products -H "authorization: Bearer <customer>" # 403

npm run test && npm run lint && npm run build
```

**হাতে যাচাই:**
1. দুটো টার্মিনাল থেকে একই variant-এ একসাথে অর্ডার → স্টক কখনো negative হয় না
2. `EXPLAIN ANALYZE` — তালিকার query index ব্যবহার করছে, seq scan নয়

---

## পরের Phase

`04-cart-checkout.md` — কার্ট, ঠিকানা, অর্ডার তৈরি, **Unique Order ID** (concurrent-safe)।
