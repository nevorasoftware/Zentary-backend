-- CreateTable
CREATE TABLE "HouseImport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "fileName" TEXT,
    "dryRun" BOOLEAN NOT NULL DEFAULT false,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "report" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseImport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HouseImport_tenantId_createdAt_idx" ON "HouseImport"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "HouseImport" ADD CONSTRAINT "HouseImport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

