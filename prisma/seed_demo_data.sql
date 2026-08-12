-- =========================================================
-- SCRIPT DE DATOS INICIALES COMPLETO (seed_demo_data.sql)
-- Ejecutar en PostgreSQL (Railway Query Editor o PgAdmin)
-- =========================================================

-- 1. Asegurar Residencial por Defecto
INSERT INTO "Community" ("id", "name", "address", "city", "updatedAt") 
VALUES ('comm-default', 'Residencial Zentary', 'Av. Las Palmas #123', 'San Salvador', NOW())
ON CONFLICT ("id") DO UPDATE SET "name" = 'Residencial Zentary';

-- 2. Insertar Propiedades / Unidades
INSERT INTO "Property" ("id", "unitNumber", "block", "communityId", "updatedAt") VALUES
('prop-119d', '119D', 'Residencia Zentary', 'comm-default', NOW()),
('prop-101a', '101-A', 'Torre Norte', 'comm-default', NOW()),
('prop-102b', '102-B', 'Torre Norte', 'comm-default', NOW()),
('prop-204c', '204-C', 'Torre Sur', 'comm-default', NOW())
ON CONFLICT ("id") DO NOTHING;

-- 3. Insertar Usuarios (Admin y Residentes)
-- Contraseña por defecto para todos encriptada en bcrypt (Zentary2026!):
-- Hash real: $2a$10$Rt9o3AByTh..c5NQ5Ah62eu/UGxNlVEMim8xEpjSiZvFFYF0981CG

INSERT INTO "User" (
  "id", "email", "password", "mustChangePassword", "fullName", "phone", 
  "role", "isActive", "avatarUrl", "communityId", "propertyId", "updatedAt"
) VALUES
-- Usuario Administrador Principal
(
  'usr-admin-1', 'admin@zentary.com', 
  '$2a$10$Rt9o3AByTh..c5NQ5Ah62eu/UGxNlVEMim8xEpjSiZvFFYF0981CG', 
  false, 'Administrador Zentary', '+503 7890-1234', 
  'ADMIN', true, 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150', 
  'comm-default', NULL, NOW()
),
-- Residente Principal: Jonathan Giron
(
  'usr-jonathan', 'misaelgrande@gmail.com', 
  '$2a$10$Rt9o3AByTh..c5NQ5Ah62eu/UGxNlVEMim8xEpjSiZvFFYF0981CG', 
  true, 'Jonathan Giron', '+503 6148-9595', 
  'RESIDENT', true, 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150', 
  'comm-default', 'prop-119d', NOW()
),
-- Otros Residentes de Ejemplo
(
  'usr-carlos', 'carlos.mendoza@gmail.com', 
  '$2a$10$Rt9o3AByTh..c5NQ5Ah62eu/UGxNlVEMim8xEpjSiZvFFYF0981CG', 
  false, 'Carlos Mendoza', '+503 7123-4567', 
  'RESIDENT', true, 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150', 
  'comm-default', 'prop-101a', NOW()
),
(
  'usr-sofia', 'sofia.martinez@gmail.com', 
  '$2a$10$Rt9o3AByTh..c5NQ5Ah62eu/UGxNlVEMim8xEpjSiZvFFYF0981CG', 
  false, 'Sofía Martínez', '+503 7888-9900', 
  'RESIDENT', true, 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150', 
  'comm-default', 'prop-102b', NOW()
),
(
  'usr-roberto', 'roberto.gomez@gmail.com', 
  '$2a$10$Rt9o3AByTh..c5NQ5Ah62eu/UGxNlVEMim8xEpjSiZvFFYF0981CG', 
  true, 'Roberto Gómez', '+503 6555-4321', 
  'RESIDENT', false, 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150', 
  'comm-default', 'prop-204c', NOW()
)
ON CONFLICT ("email") DO UPDATE SET 
  "fullName" = EXCLUDED."fullName", 
  "phone" = EXCLUDED."phone",
  "communityId" = EXCLUDED."communityId",
  "propertyId" = EXCLUDED."propertyId";

-- 4. Insertar Comunicados y Anuncios
INSERT INTO "Announcement" (
  "id", "title", "body", "category", "communityId", "authorId", "updatedAt"
) VALUES
(
  'ann-1', 'Mantenimiento Preventivo de Bomba de Agua', 
  'Se realizará una suspensión temporal del servicio de agua este jueves de 8:00 AM a 12:00 PM por trabajos de mantenimiento en la cisterna principal.', 
  'MANTENIMIENTO', 'comm-default', 'usr-admin-1', NOW()
),
(
  'ann-2', 'Asamblea General Ordinaria de Propietarios', 
  'Recordatorio de la Asamblea Ordinaria a realizarse el próximo sábado a las 4:00 PM en la Casa Club del Residencial.', 
  'EVENTO', 'comm-default', 'usr-admin-1', NOW()
),
(
  'ann-3', 'Actualización de Sistema de Garita y Tags QR', 
  'Estimados residentes, recuerden solicitar los pases QR para sus visitas directamente desde la aplicación móvil Zentary.', 
  'GENERAL', 'comm-default', 'usr-admin-1', NOW()
)
ON CONFLICT ("id") DO NOTHING;

-- 5. Insertar Registro de Visitas en Garita
INSERT INTO "Visit" (
  "id", "residentId", "visitorName", "visitorDni", "vehiclePlate", "category", "status", "qrCode", "entryDate", "updatedAt"
) VALUES
(
  'vis-1', 'usr-jonathan', 'Mario Alberto Rivas', '01234567-8', 'P-123456', 'EN_CURSO', 'IN_PROGRESS', 'QR-ZENTARY-101', NOW(), NOW()
),
(
  'vis-2', 'usr-carlos', 'Técnico Claro El Salvador', '09876543-2', 'C-876543', 'EN_CURSO', 'IN_PROGRESS', 'QR-ZENTARY-102', NOW(), NOW()
),
(
  'vis-3', 'usr-sofia', 'Ana Lucía Fernández', '04567891-3', 'P-456789', 'HISTORIAL', 'COMPLETED', 'QR-ZENTARY-103', NOW() - INTERVAL '2 days', NOW()
)
ON CONFLICT ("id") DO NOTHING;

-- 6. Insertar Encomiendas y Paquetes
INSERT INTO "Parcel" (
  "id", "residentId", "carrier", "trackingNumber", "notes", "status", "receivedAt", "updatedAt"
) VALUES
(
  'par-1', 'usr-jonathan', 'DHL', 'DHL-987654321', 'Caja mediana de Amazon enviada a recepción', 'PENDING', NOW(), NOW()
),
(
  'par-2', 'usr-carlos', 'CARGO_EXPRESS', 'CE-456123789', 'Sobres de documentos oficiales', 'PENDING', NOW(), NOW()
),
(
  'par-3', 'usr-sofia', 'FEDEX', 'FDX-11223344', 'Entrega entregada al residente', 'PICKED_UP', NOW() - INTERVAL '1 day', NOW()
)
ON CONFLICT ("id") DO NOTHING;

-- 7. Insertar Cuotas y Pagos
INSERT INTO "Payment" (
  "id", "residentId", "propertyId", "concept", "amount", "currency", "status", "dueDate", "updatedAt"
) VALUES
(
  'pay-1', 'usr-jonathan', 'prop-119d', 'Cuota Mantenimiento y Seguridad - Agosto 2026', 45.00, 'USD', 'PENDING', NOW() + INTERVAL '10 days', NOW()
),
(
  'pay-2', 'usr-carlos', 'prop-101a', 'Cuota Mantenimiento y Seguridad - Agosto 2026', 45.00, 'USD', 'PAID', NOW() - INTERVAL '5 days', NOW()
),
(
  'pay-3', 'usr-sofia', 'prop-102b', 'Cuota Mantenimiento y Seguridad - Agosto 2026', 45.00, 'USD', 'PENDING', NOW() + INTERVAL '5 days', NOW()
)
ON CONFLICT ("id") DO NOTHING;
