-- CreateEnum
CREATE TYPE "FraudLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateTable
CREATE TABLE "fraud_checks" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" "FraudLevel" NOT NULL,
    "reasons" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fraud_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fraud_checks_orderId_key" ON "fraud_checks"("orderId");

-- CreateIndex
CREATE INDEX "fraud_checks_level_createdAt_idx" ON "fraud_checks"("level", "createdAt");

-- AddForeignKey
ALTER TABLE "fraud_checks" ADD CONSTRAINT "fraud_checks_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
