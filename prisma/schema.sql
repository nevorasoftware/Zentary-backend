-- =========================================================
-- SCRIPT DE ACTUALIZACIÓN BASE DE DATOS POSTGRESQL (ZENTARY)
-- Incluye la tabla Community y el campo mustChangePassword
-- =========================================================

-- 1. Crear Tabla Community (Residenciales / Condominios)
CREATE TABLE IF NOT EXISTS "Community" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "name" TEXT NOT NULL DEFAULT 'Residencial Zentary',
    "address" TEXT,
    "city" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. Agregar columna mustChangePassword a la tabla User (Si no existe)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- 3. Agregar relación communityId a User, Property y Announcement
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "communityId" TEXT REFERENCES "Community"("id") ON DELETE SET NULL;
ALTER TABLE "Property" ADD COLUMN IF NOT EXISTS "communityId" TEXT REFERENCES "Community"("id") ON DELETE SET NULL;
ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "communityId" TEXT REFERENCES "Community"("id") ON DELETE SET NULL;

-- 4. Crear un registro de residencial por defecto si no existe
INSERT INTO "Community" ("id", "name")
VALUES ('comm-default', 'Residencial Zentary')
ON CONFLICT DO NOTHING;

-- Asignar residencial por defecto a los usuarios existentes
UPDATE "User" SET "communityId" = 'comm-default' WHERE "communityId" IS NULL;
UPDATE "Property" SET "communityId" = 'comm-default' WHERE "communityId" IS NULL;
