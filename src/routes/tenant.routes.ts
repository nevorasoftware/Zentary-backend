import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  getPaymentGateway,
  savePaymentGateway,
  deletePaymentGateway,
  testPaymentGateway,
} from '../controllers/paymentGateway.controller.js';
import {
  listTenants,
  createTenant,
  getCurrentTenant,
  updateCurrentTenant,
  updateTenantSettings,
} from '../controllers/tenant.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

const gatewayTestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'TOO_MANY_REQUESTS',
    message: 'Demasiados intentos. Inténtalo de nuevo más tarde.',
  },
});

// Rutas de administración global (Superadmin)
router.get('/', authenticateToken, requireRole('SUPER_ADMIN'), listTenants);
router.post('/', authenticateToken, requireRole('SUPER_ADMIN'), createTenant);

// Rutas de la comunidad activa / actual (Residential Admin o Superadmin)
router.get('/current', authenticateToken, getCurrentTenant);
router.put('/current', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updateCurrentTenant);
router.put('/current/settings', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updateTenantSettings);

// Credenciales de la pasarela de pagos de la residencial activa
router.get('/current/payment-gateway', authenticateToken, requireRole('SUPER_ADMIN', 'RESIDENTIAL_ADMIN', 'ADMIN'), getPaymentGateway);
router.put('/current/payment-gateway', authenticateToken, requireRole('SUPER_ADMIN'), savePaymentGateway);
router.delete('/current/payment-gateway', authenticateToken, requireRole('SUPER_ADMIN'), deletePaymentGateway);
router.post('/current/payment-gateway/test', authenticateToken, requireRole('SUPER_ADMIN'), gatewayTestLimiter, testPaymentGateway);

export default router;
