import { Router } from 'express';
import {
  getUsers,
  toggleUserAccess,
  registerTenant,
  updateTenant,
  resendTenantCredentials,
  sendWhatsAppCredentials,
  getCommunityConfig,
  updateCommunityConfig,
  getDashboardStats,
} from '../controllers/admin.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/users', getUsers);
router.patch('/users/:userId/access', toggleUserAccess);
router.post('/tenants', registerTenant);
router.put('/tenants/:tenantId', updateTenant);
router.post('/tenants/resend-credentials', resendTenantCredentials);
router.post('/tenants/send-whatsapp', sendWhatsAppCredentials);

router.get('/community', getCommunityConfig);
router.put('/community', updateCommunityConfig);

router.get('/stats', getDashboardStats);

export default router;
