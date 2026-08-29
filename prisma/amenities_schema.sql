-- =========================================================
-- ZENTARY: SCRIPT SQL PARA MIGRACIÓN DE AMENIDADES / ESPACIOS COMUNES
-- Motor de Base de Datos: PostgreSQL
-- Versión del Script: 1.0.0
-- =========================================================

-- 1. Crear ENUMs de estado si no existen
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReservationStatus') THEN
        CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReservationPaymentStatus') THEN
        CREATE TYPE "ReservationPaymentStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PAID', 'FAILED', 'CANCELLED');
    END IF;
END $$;

-- 2. Crear Tabla Amenity (Amenidades)
CREATE TABLE IF NOT EXISTS "Amenity" (
    "id" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'Salón',
    "imageUrl" TEXT,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "maxReservationTime" INTEGER NOT NULL DEFAULT 4,
    "availableDays" TEXT NOT NULL DEFAULT 'Lunes,Martes,Miércoles,Jueves,Viernes,Sábado,Domingo',
    "startTime" TEXT NOT NULL DEFAULT '08:00',
    "endTime" TEXT NOT NULL DEFAULT '22:00',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Amenity_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Amenity_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 3. Crear Tabla AmenityAvailability (Disponibilidad detallada por día de semana)
CREATE TABLE IF NOT EXISTS "AmenityAvailability" (
    "id" TEXT NOT NULL,
    "amenityId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL DEFAULT '08:00',
    "endTime" TEXT NOT NULL DEFAULT '22:00',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmenityAvailability_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AmenityAvailability_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 4. Crear Tabla AmenityReservation (Reservas de Amenidades)
CREATE TABLE IF NOT EXISTS "AmenityReservation" (
    "id" TEXT NOT NULL,
    "amenityId" TEXT NOT NULL,
    "communityId" TEXT NOT NULL,
    "residentId" TEXT NOT NULL,
    "reservationDate" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "reservationStatus" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "paymentStatus" "ReservationPaymentStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "paymentReference" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AmenityReservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AmenityReservation_amenityId_fkey" FOREIGN KEY ("amenityId") REFERENCES "Amenity"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AmenityReservation_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AmenityReservation_residentId_fkey" FOREIGN KEY ("residentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- 5. Crear Índices de Rendimiento e Integridad Referencial
CREATE INDEX IF NOT EXISTS "AmenityReservation_amenityId_reservationDate_idx" ON "AmenityReservation"("amenityId", "reservationDate");
CREATE INDEX IF NOT EXISTS "AmenityReservation_communityId_idx" ON "AmenityReservation"("communityId");
CREATE INDEX IF NOT EXISTS "AmenityReservation_residentId_idx" ON "AmenityReservation"("residentId");
CREATE INDEX IF NOT EXISTS "Amenity_communityId_idx" ON "Amenity"("communityId");
