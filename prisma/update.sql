-- =========================================================
-- SCRIPT DE ACTUALIZACIÓN DE ESTRUCTURA (update.sql)
-- Ejecutar en la base de datos existente de PostgreSQL / Railway
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

-- 2. Agregar la nueva columna mustChangePassword a la tabla User
ALTER TABLE "User" 
ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- 3. Agregar la columna communityId a la tabla User
ALTER TABLE "User" 
ADD COLUMN IF NOT EXISTS "communityId" TEXT REFERENCES "Community"("id") ON DELETE SET NULL;

-- 4. Agregar la columna communityId a la tabla Property
ALTER TABLE "Property" 
ADD COLUMN IF NOT EXISTS "communityId" TEXT REFERENCES "Community"("id") ON DELETE SET NULL;

-- 5. Agregar la columna communityId a la tabla Announcement
ALTER TABLE "Announcement" 
ADD COLUMN IF NOT EXISTS "communityId" TEXT REFERENCES "Community"("id") ON DELETE SET NULL;

-- 6. Insertar registro inicial del Residencial y asociar datos existentes
INSERT INTO "Community" ("id", "name") 
VALUES ('comm-default', 'Residencial Zentary') 
ON CONFLICT DO NOTHING;

UPDATE "User" 
SET "communityId" = 'comm-default' 
WHERE "communityId" IS NULL;

UPDATE "Property" 
SET "communityId" = 'comm-default' 
WHERE "communityId" IS NULL;
