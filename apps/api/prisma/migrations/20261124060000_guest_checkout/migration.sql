-- Guest checkout: a cart or an order may exist without an account.
--
-- Why `orders.userId` becomes nullable: in Bangladesh many buyers will
-- not create an account, and forcing registration loses sales that never
-- show up as an error anywhere.
--
-- Note the foreign key changes to ON DELETE SET NULL. Before this, a user
-- row could not be deleted while orders referenced it. Now deleting a user
-- leaves the order in place with userId = NULL, so the sales record and the
-- shipping snapshot survive the account. That is deliberate: revenue history
-- must outlive the account that produced it.

-- DropForeignKey
ALTER TABLE "orders" DROP CONSTRAINT "orders_userId_fkey";

-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "guestToken" TEXT,
ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "orders" ALTER COLUMN "userId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "carts_guestToken_key" ON "carts"("guestToken");

-- CreateIndex
CREATE INDEX "carts_guestToken_updatedAt_idx" ON "carts"("guestToken", "updatedAt");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
