import { Router } from 'express';
import {
  listTenants,
  createTenant,
  getCurrentTenant,
  updateCurrentTenant,
  updateTenantSettings,
} from '../controllers/tenant.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

// Rutas de administración global (Superadmin)
router.get('/', authenticateToken, requireRole('SUPER_ADMIN'), listTenants);
router.post('/', authenticateToken, requireRole('SUPER_ADMIN'), createTenant);

// Rutas de la comunidad activa / actual (Residential Admin o Superadmin)
router.get('/current', authenticateToken, getCurrentTenant);
router.put('/current', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updateCurrentTenant);
router.put('/current/settings', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updateTenantSettings);

export default router;
