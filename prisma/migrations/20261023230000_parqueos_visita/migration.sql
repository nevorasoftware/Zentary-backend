-- CreateTable
CREATE TABLE "VisitorParkingConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "holdMinutes" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitorParkingConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorParkingZone" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitorParkingZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorParkingReservation" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RESERVADO',
    "holdFrom" TIMESTAMP(3) NOT NULL,
    "holdUntil" TIMESTAMP(3) NOT NULL,
    "occupiedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "plate" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VisitorParkingReservation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VisitorParkingConfig_tenantId_key" ON "VisitorParkingConfig"("tenantId");

-- CreateIndex
CREATE INDEX "VisitorParkingZone_tenantId_idx" ON "VisitorParkingZone"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorParkingZone_tenantId_name_key" ON "VisitorParkingZone"("tenantId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "VisitorParkingReservation_visitId_key" ON "VisitorParkingReservation"("visitId");

-- CreateIndex
CREATE INDEX "VisitorParkingReservation_tenantId_status_idx" ON "VisitorParkingReservation"("tenantId", "status");

-- CreateIndex
CREATE INDEX "VisitorParkingReservation_zoneId_status_idx" ON "VisitorParkingReservation"("zoneId", "status");

-- AddForeignKey
ALTER TABLE "VisitorParkingConfig" ADD CONSTRAINT "VisitorParkingConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorParkingZone" ADD CONSTRAINT "VisitorParkingZone_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorParkingReservation" ADD CONSTRAINT "VisitorParkingReservation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorParkingReservation" ADD CONSTRAINT "VisitorParkingReservation_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "VisitorParkingZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisitorParkingReservation" ADD CONSTRAINT "VisitorParkingReservation_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

