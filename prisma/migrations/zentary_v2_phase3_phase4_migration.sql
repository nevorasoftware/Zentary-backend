-- ==============================================================================
-- ZENTARY 2.0 - FASE 3 (COMUNIDAD) & FASE 4 (FINANZAS): MIGRACIÓN POSTGRESQL
-- Amenidades, Reservas, Comunicados, PQRS, Cuotas, Mora Automática & Pagos
-- Nevora Software (El Salvador / Centroamérica)
-- ==============================================================================

-- 1. Actualizar enum 'ReservationStatus' con REJECTED y COMPLETED
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'REJECTED' AND enumtypid = 'ReservationStatus'::regtype) THEN
        ALTER TYPE "ReservationStatus" ADD VALUE 'REJECTED';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'COMPLETED' AND enumtypid = 'ReservationStatus'::regtype) THEN
        ALTER TYPE "ReservationStatus" ADD VALUE 'COMPLETED';
    END IF;
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

-- 2. Actualizar enum 'PaymentStatus' con PARTIAL y CANCELLED
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'PARTIAL' AND enumtypid = 'PaymentStatus'::regtype) THEN
        ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIAL';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_enum WHERE enumlabel = 'CANCELLED' AND enumtypid = 'PaymentStatus'::regtype) THEN
        ALTER TYPE "PaymentStatus" ADD VALUE 'CANCELLED';
    END IF;
EXCEPTION
    WHEN undefined_object THEN NULL;
END $$;

-- 3. Actualizar tabla 'Amenity' (Fase 3: Multi-tenant & Flexibilidad)
DO $$
BEGIN
    -- Permitir que communityId sea opcional en favor de tenantId
    ALTER TABLE "Amenity" ALTER COLUMN "communityId" DROP NOT NULL;
EXCEPTION
    WHEN others THEN NULL;
END $$;

-- Asegurar tenantId en Amenity
UPDATE "Amenity" a
SET "tenantId" = u."tenantId"
FROM "User" u
WHERE a."tenantId" IS NULL AND u."tenantId" IS NOT NULL
LIMIT 1;

UPDATE "Amenity"
SET "tenantId" = 'tenant-default-zentary'
WHERE "tenantId" IS NULL;

-- 4. Actualizar tabla 'AmenityReservation' (Fase 3: Rechazos & Viviendas)
DO $$
BEGIN
    ALTER TABLE "AmenityReservation" ALTER COLUMN "communityId" DROP NOT NULL;
EXCEPTION
    WHEN others THEN NULL;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'AmenityReservation' AND column_name = 'houseId') THEN
        ALTER TABLE "AmenityReservation" ADD COLUMN "houseId" TEXT;
        BEGIN
            ALTER TABLE "AmenityReservation" ADD CONSTRAINT "fk_reservation_house" FOREIGN KEY ("houseId") REFERENCES "House"("id") ON DELETE SET NULL;
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'AmenityReservation' AND column_name = 'rejectionReason') THEN
        ALTER TABLE "AmenityReservation" ADD COLUMN "rejectionReason" TEXT;
    END IF;
END $$;

-- 5. Actualizar tabla 'Announcement' (Fase 3: Comunicados Segmentados & Prioridad)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Announcement' AND column_name = 'priority') THEN
        ALTER TABLE "Announcement" ADD COLUMN "priority" TEXT DEFAULT 'NORMAL';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Announcement' AND column_name = 'targetAudience') THEN
        ALTER TABLE "Announcement" ADD COLUMN "targetAudience" TEXT DEFAULT 'TODOS';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Announcement' AND column_name = 'targetBlock') THEN
        ALTER TABLE "Announcement" ADD COLUMN "targetBlock" TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Announcement' AND column_name = 'expiresAt') THEN
        ALTER TABLE "Announcement" ADD COLUMN "expiresAt" TIMESTAMP(3);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Announcement' AND column_name = 'imageUrl') THEN
        ALTER TABLE "Announcement" ADD COLUMN "imageUrl" TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Announcement' AND column_name = 'fileUrl') THEN
        ALTER TABLE "Announcement" ADD COLUMN "fileUrl" TEXT;
    END IF;
END $$;

-- 6. Actualizar tabla 'Pqrs' (Fase 3: Asignación a Staff, Prioridad & Vivienda)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Pqrs' AND column_name = 'priority') THEN
        ALTER TABLE "Pqrs" ADD COLUMN "priority" TEXT DEFAULT 'MEDIA';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Pqrs' AND column_name = 'assignedToUserId') THEN
        ALTER TABLE "Pqrs" ADD COLUMN "assignedToUserId" TEXT;
        BEGIN
            ALTER TABLE "Pqrs" ADD CONSTRAINT "fk_pqrs_assigned_user" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL;
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Pqrs' AND column_name = 'houseId') THEN
        ALTER TABLE "Pqrs" ADD COLUMN "houseId" TEXT;
        BEGIN
            ALTER TABLE "Pqrs" ADD CONSTRAINT "fk_pqrs_house" FOREIGN KEY ("houseId") REFERENCES "House"("id") ON DELETE SET NULL;
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Pqrs' AND column_name = 'attachments') THEN
        ALTER TABLE "Pqrs" ADD COLUMN "attachments" TEXT;
    END IF;
END $$;

-- 7. Actualizar tabla 'Payment' (Fase 4: Finanzas, Mora Automática & Conciliación)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Payment' AND column_name = 'houseId') THEN
        ALTER TABLE "Payment" ADD COLUMN "houseId" TEXT;
        BEGIN
            ALTER TABLE "Payment" ADD CONSTRAINT "fk_payment_house" FOREIGN KEY ("houseId") REFERENCES "House"("id") ON DELETE SET NULL;
        EXCEPTION
            WHEN duplicate_object THEN NULL;
        END;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Payment' AND column_name = 'lateFee') THEN
        ALTER TABLE "Payment" ADD COLUMN "lateFee" DOUBLE PRECISION NOT NULL DEFAULT 0.0;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Payment' AND column_name = 'graceDays') THEN
        ALTER TABLE "Payment" ADD COLUMN "graceDays" INTEGER NOT NULL DEFAULT 3;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Payment' AND column_name = 'lateFeeApplied') THEN
        ALTER TABLE "Payment" ADD COLUMN "lateFeeApplied" BOOLEAN NOT NULL DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Payment' AND column_name = 'receiptUrl') THEN
        ALTER TABLE "Payment" ADD COLUMN "receiptUrl" TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Payment' AND column_name = 'confirmedByUserId') THEN
        ALTER TABLE "Payment" ADD COLUMN "confirmedByUserId" TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Payment' AND column_name = 'confirmedAt') THEN
        ALTER TABLE "Payment" ADD COLUMN "confirmedAt" TIMESTAMP(3);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Payment' AND column_name = 'periodMonth') THEN
        ALTER TABLE "Payment" ADD COLUMN "periodMonth" INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Payment' AND column_name = 'periodYear') THEN
        ALTER TABLE "Payment" ADD COLUMN "periodYear" INTEGER;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Payment' AND column_name = 'notes') THEN
        ALTER TABLE "Payment" ADD COLUMN "notes" TEXT;
    END IF;
END $$;

-- 8. Crear índices optimizados para cobranza y estado de cuenta
CREATE INDEX IF NOT EXISTS "idx_payment_tenant_status" ON "Payment" ("tenantId", "status");
CREATE INDEX IF NOT EXISTS "idx_payment_house" ON "Payment" ("houseId");
CREATE INDEX IF NOT EXISTS "idx_payment_due_date" ON "Payment" ("dueDate");
CREATE INDEX IF NOT EXISTS "idx_announcement_tenant_created" ON "Announcement" ("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "idx_pqrs_tenant_status" ON "Pqrs" ("tenantId", "status");

-- 9. Sincronizar tenantId y houseId en pagos históricos
DO $$
BEGIN
    UPDATE "Payment" p
    SET "tenantId" = u."tenantId",
        "houseId" = u."houseId"
    FROM "User" u
    WHERE p."residentId" = u."id"
      AND (p."tenantId" IS NULL OR p."houseId" IS NULL);
END $$;

-- ==============================================================================
-- FIN DE SCRIPT DE MIGRACIÓN POSTGRESQL FASE 3 & 4 - ZENTARY 2.0
-- ==============================================================================
