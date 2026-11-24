-- Courier dispatch: courier accounts, parcels and their event history.
--
-- Credentials live in the database, not in .env, because this code ships to
-- other businesses. Changing a key by editing a file on the server and
-- restarting is not something a shop owner will do, so the admin panel has to
-- own the setup. The values are encrypted (see src/common/secret-box.ts); the
-- master key is the one thing that stays in .env, or the lock and the key would
-- sit in the same box.
--
-- A shipment is a separate row from the order because a returned parcel can be
-- sent again: two parcels, one order. Tracking numbers on the order itself
-- would lose the first attempt.


-- CreateEnum
CREATE TYPE "CourierKind" AS ENUM ('STEADFAST', 'PATHAO', 'REDX', 'CARRYBEE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED', 'RETURNED', 'CANCELLED');

-- CreateTable
CREATE TABLE "courier_accounts" (
    "id" TEXT NOT NULL,
    "kind" "CourierKind" NOT NULL,
    "label" TEXT NOT NULL,
    "credentials" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isSandbox" BOOLEAN NOT NULL DEFAULT false,
    "webhookSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "courier_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "courierAccountId" TEXT NOT NULL,
    "courier" "CourierKind" NOT NULL,
    "consignmentId" TEXT,
    "trackingCode" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "rawStatus" TEXT,
    "codAmountPaisa" INTEGER NOT NULL DEFAULT 0,
    "courierFeePaisa" INTEGER,
    "failureReason" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipment_events" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "rawStatus" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "courier_accounts_kind_key" ON "courier_accounts"("kind");

-- CreateIndex
CREATE INDEX "shipments_orderId_idx" ON "shipments"("orderId");

-- CreateIndex
CREATE INDEX "shipments_status_createdAt_idx" ON "shipments"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_courier_consignmentId_key" ON "shipments"("courier", "consignmentId");

-- CreateIndex
CREATE INDEX "shipment_events_shipmentId_createdAt_idx" ON "shipment_events"("shipmentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "shipment_events_shipmentId_status_occurredAt_key" ON "shipment_events"("shipmentId", "status", "occurredAt");

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_courierAccountId_fkey" FOREIGN KEY ("courierAccountId") REFERENCES "courier_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipment_events" ADD CONSTRAINT "shipment_events_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- The MANUAL courier is seeded here, not in seed.ts, deliberately.
--
-- CI never seeds, and neither will a shop owner who just runs db:deploy. With
-- no courier account at all the dispatch screen would be empty and no order
-- could be marked shipped, on a fresh install, with no clue why. MANUAL needs
-- no API key, so it can always be there.
--
-- WHERE NOT EXISTS keeps this safe to run on a database that already has it.
INSERT INTO "courier_accounts" (
  "id", "kind", "label", "credentials", "isActive", "isDefault",
  "isSandbox", "webhookSecret", "createdAt", "updatedAt"
)
SELECT
  'courier_manual_seeded', 'MANUAL', 'নিজের ডেলিভারি', NULL, true, true,
  false, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (
  SELECT 1 FROM "courier_accounts" WHERE "kind" = 'MANUAL'
);
