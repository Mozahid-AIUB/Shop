-- A coupon redemption may belong to a guest order, which has no user.
--
-- The row is still written. The per-customer limit is counted off this column,
-- so a guest can only use a coupon that waives that limit -- but the admin still
-- needs to see the total discount a campaign gave away, and that total has to
-- include guest orders or the report understates the cost.
--
-- ON DELETE SET NULL for the same reason as orders: deleting a customer account
-- must not erase what a campaign cost the shop.

-- DropForeignKey
ALTER TABLE "coupon_redemptions" DROP CONSTRAINT "coupon_redemptions_userId_fkey";

-- AlterTable
ALTER TABLE "coupon_redemptions" ALTER COLUMN "userId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
