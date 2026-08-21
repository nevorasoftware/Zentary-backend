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

// Auto-ensure required database columns exist on startup
const initDbSchema = async () => {
  try {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "pushToken" TEXT;`);
    console.log('✅ Database schema verified: User.pushToken column is ready.');
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
