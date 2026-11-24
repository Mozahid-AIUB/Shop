-- A coupon may now waive its per-customer limit.
--
-- `maxUsesPerUser` becoming nullable is what lets a guest use a coupon at all.
-- Counting "how many times has this customer used it" needs a user id, which a
-- guest does not have. With the limit set to NULL there is nothing to count, so
-- the coupon works for everyone. With a limit set, the coupon is reserved for
-- signed-in customers -- otherwise one person could drain a whole campaign from
-- an incognito window.
--
-- The default stays 1, so an admin who says nothing still gets the safe rule.

-- AlterTable
ALTER TABLE "coupons" ALTER COLUMN "maxUsesPerUser" DROP NOT NULL;
