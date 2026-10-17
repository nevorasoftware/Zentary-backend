-- ==============================================================================
-- ZENTARY 2.0 - FASE 1: MIGRACIÓN DE ARQUITECTURA MULTI-TENANT & POSTGRESQL CORE
-- Plataforma Integral de Gestión Residencial, Comunidad y Control de Accesos
-- Nevora Software (El Salvador / Centroamérica)
-- ==============================================================================

-- 1. Habilitar extensión UUID si no existe
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Actualizar enum 'Role' con los nuevos roles RBAC de Zentary 2.0
DO $$
BEGIN
    -- Agregar SUPER_ADMIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'SUPER_ADMIN' AND enumtypid = 'Role'::regtype) THEN
        ALTER TYPE "Role" ADD VALUE 'SUPER_ADMIN';
    END IF;
    -- Agregar RESIDENTIAL_ADMIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'RESIDENTIAL_ADMIN' AND enumtypid = 'Role'::regtype) THEN
        ALTER TYPE "Role" ADD VALUE 'RESIDENTIAL_ADMIN';
    END IF;
    -- Agregar SECURITY_ADMIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'SECURITY_ADMIN' AND enumtypid = 'Role'::regtype) THEN
        ALTER TYPE "Role" ADD VALUE 'SECURITY_ADMIN';
    END IF;
EXCEPTION
    WHEN undefined_object THEN
        -- Si el tipo Role no existe, crearlo completo
        CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'RESIDENTIAL_ADMIN', 'SECURITY_ADMIN', 'GUARD', 'RESIDENT', 'ADMIN');
END $$;

-- 3. Crear tabla 'Tenant' (Entidad central multi-tenant)
CREATE TABLE IF NOT EXISTS "Tenant" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    "name" TEXT NOT NULL DEFAULT 'Residencial Zentary',
    "slug" TEXT UNIQUE,
    "address" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "whatsapp" TEXT,
    "logoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Si existe la tabla histórica 'Community', migrar residenciales existentes a 'Tenant'
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Community') THEN
        INSERT INTO "Tenant" ("id", "name", "address", "city", "logoUrl", "createdAt", "updatedAt")
        SELECT "id", "name", "address", "city", "logoUrl", "createdAt", "updatedAt"
        FROM "Community"
        ON CONFLICT ("id") DO NOTHING;
    END IF;
END $$;

-- Asegurar al menos un Tenant por defecto si la tabla está vacía
INSERT INTO "Tenant" ("id", "name", "slug", "city", "isActive")
SELECT 'tenant-default-zentary', 'Residencial Zentary Central', 'zentary-central', 'San Salvador', true
WHERE NOT EXISTS (SELECT 1 FROM "Tenant");

-- 4. Crear tabla 'TenantSettings' (Configuración por residencial - Principio 63 y 64)
CREATE TABLE IF NOT EXISTS "TenantSettings" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    "tenantId" TEXT NOT NULL UNIQUE REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "qrExpirationMinutes" INTEGER NOT NULL DEFAULT 15,
    "visitorMaxDurationHours" INTEGER NOT NULL DEFAULT 4,
    "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "servicesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "amenitiesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "onlinePaymentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushNotificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
    "maintenanceEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pqrsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "defaultGraceDays" INTEGER NOT NULL DEFAULT 3,
    "defaultLateFeePercent" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "hmacSecretKey" TEXT DEFAULT md5(random()::text || clock_timestamp()::text),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Crear settings por defecto para todo Tenant que no lo tenga
INSERT INTO "TenantSettings" ("tenantId")
SELECT "id" FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "TenantSettings" ts WHERE ts."tenantId" = t."id");

-- 5. Crear tabla 'House' (Viviendas del residencial - Sección 9)
CREATE TABLE IF NOT EXISTS "House" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "unitNumber" TEXT NOT NULL,
    "block" TEXT,
    "type" TEXT NOT NULL DEFAULT 'CASA',
    "status" TEXT NOT NULL DEFAULT 'HABITADA',
    "ownerName" TEXT,
    "ownerPhone" TEXT,
    "ownerEmail" TEXT,
    "financialStatus" TEXT NOT NULL DEFAULT 'SOLVENTE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "House_tenant_unit_block_unique" UNIQUE ("tenantId", "unitNumber", "block")
);

CREATE INDEX IF NOT EXISTS "idx_house_tenant" ON "House"("tenantId");
CREATE INDEX IF NOT EXISTS "idx_house_financial" ON "House"("tenantId", "financialStatus");

-- Si existe la tabla 'Property', migrar datos a 'House'
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'Property') THEN
        INSERT INTO "House" ("id", "tenantId", "unitNumber", "block", "createdAt", "updatedAt")
        SELECT 
            p."id",
            COALESCE(p."communityId", (SELECT "id" FROM "Tenant" LIMIT 1)),
            p."unitNumber",
            p."block",
            p."createdAt",
            p."updatedAt"
        FROM "Property" p
        ON CONFLICT ("id") DO NOTHING;
    END IF;
END $$;

-- 6. Actualizar tabla 'User' con campos Zentary 2.0 y aislamiento por Tenant
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tenantId" TEXT REFERENCES "Tenant"("id") ON DELETE SET NULL;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "houseId" TEXT REFERENCES "House"("id") ON DELETE SET NULL;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "whatsapp" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "documentType" TEXT DEFAULT 'DUI';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "documentNumber" TEXT;

-- Backfill tenantId y houseId en User a partir de datos existentes
UPDATE "User" 
SET "tenantId" = COALESCE("communityId", (SELECT "id" FROM "Tenant" LIMIT 1))
WHERE "tenantId" IS NULL;

UPDATE "User"
SET "houseId" = "propertyId"
WHERE "houseId" IS NULL AND "propertyId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "idx_user_tenant" ON "User"("tenantId");
CREATE INDEX IF NOT EXISTS "idx_user_house" ON "User"("houseId");
CREATE INDEX IF NOT EXISTS "idx_user_role" ON "User"("role");

-- 7. Crear tabla 'Vehicle' (Vehículos registrados - Sección 21)
CREATE TABLE IF NOT EXISTS "Vehicle" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "houseId" TEXT REFERENCES "House"("id") ON DELETE SET NULL,
    "residentId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
    "brand" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "plate" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SEDAN',
    "photoUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_vehicle_tenant_plate" ON "Vehicle"("tenantId", "plate");
CREATE INDEX IF NOT EXISTS "idx_vehicle_house" ON "Vehicle"("houseId");

-- 8. Crear tablas de Garitas y Turnos de Vigilancia (Secciones 56 y 57)
CREATE TABLE IF NOT EXISTS "Gate" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "name" TEXT NOT NULL DEFAULT 'Garita Principal',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_gate_tenant" ON "Gate"("tenantId");

CREATE TABLE IF NOT EXISTS "GuardShift" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "guardId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "gateId" TEXT NOT NULL REFERENCES "Gate"("id") ON DELETE CASCADE,
    "startTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endTime" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_guard_shift_tenant" ON "GuardShift"("tenantId", "status");

-- 9. Crear tabla 'PushDevice' (Dispositivos Push multidispositivo - Sección 33)
CREATE TABLE IF NOT EXISTS "PushDevice" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "deviceToken" TEXT NOT NULL UNIQUE,
    "platform" TEXT NOT NULL DEFAULT 'android',
    "deviceName" TEXT,
    "appVersion" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_pushdevice_user" ON "PushDevice"("userId", "active");

-- 10. Crear tabla 'Notification' (Notificaciones persistentes con Deep Linking - Sección 34)
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_notification_user" ON "Notification"("tenantId", "userId", "createdAt");

-- 11. Crear tabla 'AuditLog' (Trazabilidad y Auditoría Forense - Sección 43)
CREATE TABLE IF NOT EXISTS "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT uuid_generate_v4()::TEXT,
    "tenantId" TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE,
    "userId" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "details" TEXT,
    "ipAddress" TEXT,
    "result" TEXT NOT NULL DEFAULT 'SUCCESS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "idx_auditlog_tenant" ON "AuditLog"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_auditlog_action" ON "AuditLog"("action");

-- 12. Aislamiento Multi-Tenant en Entidades Existentes (Añadir tenantId e índices)
-- Visit
ALTER TABLE "Visit" ADD COLUMN IF NOT EXISTS "tenantId" TEXT REFERENCES "Tenant"("id") ON DELETE SET NULL;
UPDATE "Visit" v
SET "tenantId" = u."tenantId"
FROM "User" u
WHERE v."residentId" = u."id" AND v."tenantId" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_visit_tenant" ON "Visit"("tenantId");
CREATE INDEX IF NOT EXISTS "idx_visit_tenant_status" ON "Visit"("tenantId", "status");

-- Parcel
ALTER TABLE "Parcel" ADD COLUMN IF NOT EXISTS "tenantId" TEXT REFERENCES "Tenant"("id") ON DELETE SET NULL;
UPDATE "Parcel" p
SET "tenantId" = u."tenantId"
FROM "User" u
WHERE p."residentId" = u."id" AND p."tenantId" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_parcel_tenant" ON "Parcel"("tenantId");

-- Pqrs
ALTER TABLE "Pqrs" ADD COLUMN IF NOT EXISTS "tenantId" TEXT REFERENCES "Tenant"("id") ON DELETE SET NULL;
UPDATE "Pqrs" pq
SET "tenantId" = u."tenantId"
FROM "User" u
WHERE pq."residentId" = u."id" AND pq."tenantId" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_pqrs_tenant" ON "Pqrs"("tenantId");

-- Payment
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "tenantId" TEXT REFERENCES "Tenant"("id") ON DELETE SET NULL;
UPDATE "Payment" pay
SET "tenantId" = u."tenantId"
FROM "User" u
WHERE pay."residentId" = u."id" AND pay."tenantId" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_payment_tenant" ON "Payment"("tenantId");

-- Amenity
ALTER TABLE "Amenity" ADD COLUMN IF NOT EXISTS "tenantId" TEXT REFERENCES "Tenant"("id") ON DELETE SET NULL;
UPDATE "Amenity" a
SET "tenantId" = a."communityId"
WHERE a."tenantId" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_amenity_tenant" ON "Amenity"("tenantId");

-- AmenityReservation
ALTER TABLE "AmenityReservation" ADD COLUMN IF NOT EXISTS "tenantId" TEXT REFERENCES "Tenant"("id") ON DELETE SET NULL;
UPDATE "AmenityReservation" ar
SET "tenantId" = ar."communityId"
WHERE ar."tenantId" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_amenityreservation_tenant" ON "AmenityReservation"("tenantId");

-- Announcement
ALTER TABLE "Announcement" ADD COLUMN IF NOT EXISTS "tenantId" TEXT REFERENCES "Tenant"("id") ON DELETE SET NULL;
UPDATE "Announcement" an
SET "tenantId" = an."communityId"
WHERE an."tenantId" IS NULL;
CREATE INDEX IF NOT EXISTS "idx_announcement_tenant" ON "Announcement"("tenantId");

-- ==============================================================================
-- FIN DE SCRIPT DE MIGRACIÓN POSTGRESQL FASE 1 - ZENTARY 2.0
-- ==============================================================================
