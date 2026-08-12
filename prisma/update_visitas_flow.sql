-- SQL Migration Script for Zentary Visitor Authorization Flow
-- File: prisma/update_visitas_flow.sql

-- 1. Add new enum values to VisitStatus if enum exists
ALTER TYPE "VisitStatus" ADD VALUE IF NOT EXISTS 'PENDIENTE_REGISTRO';
ALTER TYPE "VisitStatus" ADD VALUE IF NOT EXISTS 'DATOS_COMPLETADOS';
ALTER TYPE "VisitStatus" ADD VALUE IF NOT EXISTS 'INGRESADA';
ALTER TYPE "VisitStatus" ADD VALUE IF NOT EXISTS 'CANCELADA';
ALTER TYPE "VisitStatus" ADD VALUE IF NOT EXISTS 'VENCIDA';

-- 2. Alter "Visit" table to add new fields
ALTER TABLE "Visit" 
  ADD COLUMN IF NOT EXISTS "visitorPhone" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "documentType" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "documentNumber" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "documentPhotoUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "hasVehicle" BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "vehicleModel" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "vehicleColor" VARCHAR(50),
  ADD COLUMN IF NOT EXISTS "validFrom" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "validUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "publicToken" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "guardId" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "gateName" VARCHAR(100) DEFAULT 'Puerta Principal';

-- Create unique index on publicToken
CREATE UNIQUE INDEX IF NOT EXISTS "Visit_publicToken_key" ON "Visit"("publicToken");

-- Add foreign key constraint for guardId referencing User(id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'Visit_guardId_fkey'
    ) THEN
        ALTER TABLE "Visit" ADD CONSTRAINT "Visit_guardId_fkey" FOREIGN KEY ("guardId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
    END IF;
END $$;

-- 3. Create VisitToken table for dynamic 15-min access tokens
CREATE TABLE IF NOT EXISTS "VisitToken" (
    "id" TEXT NOT NULL,
    "visitId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "isRevoked" BOOLEAN NOT NULL DEFAULT FALSE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisitToken_pkey" PRIMARY KEY ("id")
);

-- Create unique index on VisitToken token
CREATE UNIQUE INDEX IF NOT EXISTS "VisitToken_token_key" ON "VisitToken"("token");

-- Add foreign key constraint for VisitToken referencing Visit(id)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'VisitToken_visitId_fkey'
    ) THEN
        ALTER TABLE "VisitToken" ADD CONSTRAINT "VisitToken_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "Visit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
