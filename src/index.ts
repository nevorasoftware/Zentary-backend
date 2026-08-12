import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import apiRoutes from './routes/index.js';
import { renderVisitorWebPage } from './controllers/public.controller.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(
  helmet({
    contentSecurityPolicy: false, // Allowed for embedded QR canvas script
  })
);
app.use(cors());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
