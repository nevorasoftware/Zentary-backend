-- ==============================================================================
-- ZENTARY 2.0 - FASE 2: CONTROL DE ACCESOS, QR CRIPTOGRÁFICO Y GESTIÓN DE GARITA
-- Plataforma Integral de Gestión Residencial, Comunidad y Control de Accesos
-- Nevora Software (El Salvador / Centroamérica)
-- ==============================================================================

-- 1. Agregar campos de vivienda, permanencia y tipo de ingreso a la tabla 'Visit'
DO $$
BEGIN
    -- houseId (relación opcional con House)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Visit' AND column_name = 'houseId') THEN
        ALTER TABLE "Visit" ADD COLUMN "houseId" TEXT;
        BEGIN
            ALTER TABLE "Visit" ADD CONSTRAINT "fk_visit_house" FOREIGN KEY ("houseId") REFERENCES "House"("id") ON DELETE SET NULL;
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END;
    END IF;

    -- durationMinutes (tiempo total de permanencia en minutos)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Visit' AND column_name = 'durationMinutes') THEN
        ALTER TABLE "Visit" ADD COLUMN "durationMinutes" INTEGER;
    END IF;

    -- maxDurationHours (duración máxima autorizada en horas para la visita)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Visit' AND column_name = 'maxDurationHours') THEN
        ALTER TABLE "Visit" ADD COLUMN "maxDurationHours" INTEGER DEFAULT 4;
    END IF;

    -- entryType (tipo de ingreso: VISIT, DELIVERY, SERVICE, TAXI)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Visit' AND column_name = 'entryType') THEN
        ALTER TABLE "Visit" ADD COLUMN "entryType" TEXT DEFAULT 'VISIT';
    END IF;

    -- gateId (relación opcional con la garita física registrada)
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Visit' AND column_name = 'gateId') THEN
        ALTER TABLE "Visit" ADD COLUMN "gateId" TEXT;
    END IF;
END $$;

-- 2. Crear índices optimizados para el monitoreo de garita y permanencia en tiempo real
CREATE INDEX IF NOT EXISTS "idx_visit_tenant_active" ON "Visit" ("tenantId", "status", "entryDate", "exitDate");
CREATE INDEX IF NOT EXISTS "idx_visit_house" ON "Visit" ("houseId");
CREATE INDEX IF NOT EXISTS "idx_visit_public_token" ON "Visit" ("publicToken");

-- 3. Poblar houseId para visitas existentes basadas en la vivienda del usuario residente
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'User' AND column_name = 'houseId') THEN
        UPDATE "Visit" v
        SET "houseId" = u."houseId"
        FROM "User" u
        WHERE v."residentId" = u."id"
          AND v."houseId" IS NULL
          AND u."houseId" IS NOT NULL;
    END IF;
END $$;

-- 4. Crear Garita por defecto para cada Tenant que aún no tenga Garitas registradas
INSERT INTO "Gate" ("id", "tenantId", "name", "description", "isActive", "createdAt", "updatedAt")
SELECT 
    'gate-' || t."id",
    t."id",
    'Garita Principal',
    'Acceso vehicular y peatonal principal',
    true,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM "Tenant" t
WHERE NOT EXISTS (SELECT 1 FROM "Gate" g WHERE g."tenantId" = t."id");

-- 5. Asegurar clave HMAC secreta por tenant para la firma criptográfica de QRs dinámicos
UPDATE "TenantSettings"
SET "hmacSecretKey" = md5(random()::text || clock_timestamp()::text)
WHERE "hmacSecretKey" IS NULL OR "hmacSecretKey" = '';

-- ==============================================================================
-- FIN DE SCRIPT DE MIGRACIÓN POSTGRESQL FASE 2 - ZENTARY 2.0
-- ==============================================================================
