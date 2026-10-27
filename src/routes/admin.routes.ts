import { Router } from 'express';
import {
  getUsers,
  toggleUserAccess,
  releaseResident,
  registerTenant,
  registerGuard,
  updateTenant,
  resendTenantCredentials,
  sendWhatsAppCredentials,
  getCommunityConfig,
  updateCommunityConfig,
  getDashboardStats,
} from '../controllers/admin.controller.js';
import { authenticateToken, requireRole, requireTenant } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), requireTenant);

router.get('/users', getUsers);
router.patch('/users/:userId/access', toggleUserAccess);
router.post('/users/:userId/release', releaseResident);
router.post('/tenants', registerTenant);
router.post('/guards', registerGuard);
router.put('/tenants/:tenantId', updateTenant);
router.post('/tenants/resend-credentials', resendTenantCredentials);
router.post('/tenants/send-whatsapp', sendWhatsAppCredentials);

router.get('/community', getCommunityConfig);
router.put('/community', updateCommunityConfig);

router.get('/stats', getDashboardStats);

export default router;
