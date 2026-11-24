-- অন্তত একটা default shipping zone নিশ্চিত করা।
--
-- **কেন migration-এ, seed-এ নয়:** default zone না থাকলে অচেনা জেলার
-- checkout 500 দেয় — `ShippingService.quote()` ইচ্ছাকৃতভাবে throw করে,
-- যাতে চুপচাপ ফ্রি ডেলিভারি দিয়ে প্রতি অর্ডারে লোকসান না হয়।
--
-- seed ঐচ্ছিক: CI চালায় না, আর যে ব্যবসায়ী এই কোড কিনে install করবে
-- সে-ও হয়তো চালাবে না। তাই শুধু seed-এ রাখলে migrate করে দোকান খুলতে
-- গেলে **প্রথম অর্ডারেই** ভাঙত। আগের migration-এ এটা যোগ করা যায় না,
-- কারণ সেটা ইতিমধ্যে প্রয়োগ হয়ে গেছে — checksum মিলত না।
--
-- `NOT EXISTS` শর্তে: চালু দোকানের নিজের সাজানো zone-গুলো অক্ষত থাকে,
-- আর migration আবার চললেও দুটো default তৈরি হয় না।
--
-- হারটা নিরাপদ একটা শুরু মাত্র — অ্যাডমিন প্যানেল থেকে বদলানো যায়।
INSERT INTO "shipping_zones" (
  "id", "name", "districts", "chargePaisa", "freeAbovePaisa",
  "isDefault", "isActive", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  'zone_default_seeded', 'সারা দেশ', ARRAY[]::TEXT[], 12000, NULL,
  true, true, 100, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "shipping_zones" WHERE "isDefault" = true
);
