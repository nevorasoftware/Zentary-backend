-- AlterTable
ALTER TABLE "House" ADD COLUMN     "prefixId" TEXT;

-- CreateTable
CREATE TABLE "HousePrefix" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT,
    "houseType" TEXT NOT NULL DEFAULT 'CASA',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HousePrefix_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HousePrefix_tenantId_idx" ON "HousePrefix"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "HousePrefix_tenantId_code_key" ON "HousePrefix"("tenantId", "code");

-- AddForeignKey
ALTER TABLE "House" ADD CONSTRAINT "House_prefixId_fkey" FOREIGN KEY ("prefixId") REFERENCES "HousePrefix"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HousePrefix" ADD CONSTRAINT "HousePrefix_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

