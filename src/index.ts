import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import apiRoutes from './routes/index.js';
import { renderVisitorWebPage } from './controllers/public.controller.js';
import { prisma } from './config/prisma.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Auto-ensure required database columns & tables exist on startup
const initDbSchema = async () => {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pushToken" TEXT;`);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "Amenity" (
        "id" TEXT NOT NULL PRIMARY KEY,
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
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AmenityReservation" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "amenityId" TEXT NOT NULL,
        "communityId" TEXT NOT NULL,
        "residentId" TEXT NOT NULL,
        "reservationDate" TIMESTAMP(3) NOT NULL,
        "startTime" TEXT NOT NULL,
        "endTime" TEXT NOT NULL,
        "price" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
        "reservationStatus" TEXT NOT NULL DEFAULT 'PENDING',
        "paymentStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
        "paymentReference" TEXT,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log('✅ Database schema verified: Amenity and AmenityReservation tables are ready.');
  } catch (err: any) {
    console.error('⚠️ Schema auto-migration warning:', err.message);
  }
};

initDbSchema();

// Middlewares
app.use(
  helmet({
    contentSecurityPolicy: false, // Allowed for embedded QR canvas script
  })
);
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Healthcheck Route
app.get('/health', (_req, res) => {
  res.json({
    status: 'online',
    service: 'Zentary Backend API',
    timestamp: new Date().toISOString(),
  });
});

// Public Visitor HTML Web App Route
app.get('/visit/:publicToken', renderVisitorWebPage);

// API Endpoints
app.use('/api', apiRoutes);

// 404 Handler
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Ruta no encontrada' });
});

// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Zentary Backend API server running on port ${PORT}`);
});
