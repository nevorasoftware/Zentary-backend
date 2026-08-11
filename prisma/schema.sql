-- =========================================================
-- SCRIPT DE INICIALIZACIÓN DE BASE DE DATOS POSTGRESQL (ZENTARY)
-- Puede ejecutarse en la consola SQL de Railway o cliente PostgreSQL
-- =========================================================

-- 1. Crear Tipos ENUM
CREATE TYPE "Role" AS ENUM ('RESIDENT', 'ADMIN', 'GUARD');
CREATE TYPE "VisitStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED');
CREATE TYPE "AccessCategory" AS ENUM ('EN_CURSO', 'HISTORIAL', 'FRECUENTE');
CREATE TYPE "CarrierType" AS ENUM ('CARGO_EXPRESS', 'DHL', 'FEDEX', 'TRANS_EXPRESS', 'UPS', 'OTRO');
CREATE TYPE "ParcelStatus" AS ENUM ('PENDING', 'PICKED_UP', 'CANCELLED');
CREATE TYPE "PqrsCategory" AS ENUM ('PETICION', 'QUEJA', 'RECLAMO', 'SUGERENCIA');
CREATE TYPE "PqrsStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'FAILED');
CREATE TYPE "AnnouncementCategory" AS ENUM ('MANTENIMIENTO', 'URGENTE', 'EVENTO', 'GENERAL');

-- 2. Tabla Property (Propiedades / Apartamentos)
CREATE TABLE "Property" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "unitNumber" TEXT NOT NULL,
    "block" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Tabla User (Usuarios, Administradores, Guardias)
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "email" TEXT NOT NULL UNIQUE,
    "password" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT,
    "role" "Role" NOT NULL DEFAULT 'RESIDENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "avatarUrl" TEXT,
    "propertyId" TEXT REFERENCES "Property"("id") ON DELETE SET NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Tabla Visit (Accesos y Visitas)
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "residentId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "visitorName" TEXT NOT NULL,
    "visitorDni" TEXT,
    "vehiclePlate" TEXT,
    "category" "AccessCategory" NOT NULL DEFAULT 'EN_CURSO',
    "status" "VisitStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "allowedDays" TEXT,
    "allowedHours" TEXT,
    "qrCode" TEXT,
    "notes" TEXT,
    "entryDate" TIMESTAMP(3),
    "exitDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 5. Tabla FrequentAccessConfig (Ajustes de aviso frecuente)
CREATE TABLE "FrequentAccessConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "userId" TEXT NOT NULL UNIQUE REFERENCES "User"("id") ON DELETE CASCADE,
    "hideFrequentAccessBanner" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. Tabla Parcel (Mensajería y Encomiendas)
CREATE TABLE "Parcel" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "residentId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "carrier" "CarrierType" NOT NULL,
    "customCarrier" TEXT,
    "trackingNumber" TEXT,
    "photoUrl" TEXT,
    "notes" TEXT,
    "status" "ParcelStatus" NOT NULL DEFAULT 'PENDING',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pickedUpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. Tabla Pqrs (Tickets de Soporte / Comunicaciones)
CREATE TABLE "Pqrs" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "residentId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "category" "PqrsCategory" NOT NULL DEFAULT 'PETICION',
    "subject" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "PqrsStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 8. Tabla PqrsMessage (Mensajes de soporte)
CREATE TABLE "PqrsMessage" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "pqrsId" TEXT NOT NULL REFERENCES "Pqrs"("id") ON DELETE CASCADE,
    "senderId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
    "message" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 9. Tabla Announcement (Anuncios globales)
CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" "AnnouncementCategory" NOT NULL DEFAULT 'GENERAL',
    "authorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 10. Tabla Payment (Módulo de Pagos y Mantenimiento)
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
    "residentId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
    "propertyId" TEXT REFERENCES "Property"("id") ON DELETE SET NULL,
    "concept" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "paymentMethod" TEXT,
    "externalTransactionId" TEXT,
    "rawGatewayResponse" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- =========================================================
-- REGISTROS INICIALES DE PRUEBA (DATOS SEMILLA)
-- Contraseña hasheada para 'zentary123': $2b$10$w4rYx51q8T.Z.V40eQ.Q9u/R30NfN83X.mO.O3v0xG5E1h4fX7O2S
-- =========================================================

-- Insertar Propiedad
INSERT INTO "Property" ("id", "unitNumber", "block") 
VALUES ('prop-101', 'Apt 502', 'Torre B');

-- Insertar Usuario Administrador (admin@zentary.com / zentary123)
INSERT INTO "User" ("id", "email", "password", "fullName", "phone", "role", "isActive", "avatarUrl") 
VALUES (
    'usr-admin-1', 
    'admin@zentary.com', 
    '$2b$10$w4rYx51q8T.Z.V40eQ.Q9u/R30NfN83X.mO.O3v0xG5E1h4fX7O2S', 
    'Administrador Zentary', 
    '+503 7000-0000', 
    'ADMIN', 
    true, 
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150'
);

-- Insertar Usuario Residente (residente@zentary.com / zentary123)
INSERT INTO "User" ("id", "email", "password", "fullName", "phone", "role", "isActive", "propertyId", "avatarUrl") 
VALUES (
    'usr-resident-1', 
    'residente@zentary.com', 
    '$2b$10$w4rYx51q8T.Z.V40eQ.Q9u/R30NfN83X.mO.O3v0xG5E1h4fX7O2S', 
    'María Camila Rodríguez', 
    '+503 7888-9999', 
    'RESIDENT', 
    true, 
    'prop-101', 
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150'
);

-- Insertar Anuncio de Bienvenida
INSERT INTO "Announcement" ("id", "title", "body", "category", "authorId") 
VALUES (
    'ann-1', 
    '¡Bienvenidos a Zentary Residencial!', 
    'La plataforma de control de accesos y servicios residenciales está oficialmente activa.', 
    'GENERAL', 
    'usr-admin-1'
);
