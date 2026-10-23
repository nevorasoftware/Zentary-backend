-- CreateTable
CREATE TABLE "HouseOccupancyLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "houseId" TEXT NOT NULL,
    "previousUserId" TEXT,
    "newUserId" TEXT,
    "reason" TEXT,
    "performedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseOccupancyLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HouseOccupancyLog_tenantId_houseId_idx" ON "HouseOccupancyLog"("tenantId", "houseId");

-- AddForeignKey
ALTER TABLE "HouseOccupancyLog" ADD CONSTRAINT "HouseOccupancyLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

