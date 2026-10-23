import { Router } from 'express';
import {
  listZones,
  getParkingStatus,
  createZone,
  updateZone,
  deleteZone,
  updateConfig,
} from '../controllers/parking.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/zones', requireRole('RESIDENTIAL_ADMIN', 'ADMIN', 'SECURITY_ADMIN', 'GUARD'), listZones);
router.get('/status', requireRole('RESIDENTIAL_ADMIN', 'ADMIN', 'SECURITY_ADMIN', 'GUARD'), getParkingStatus);
router.post('/zones', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), createZone);
router.put('/zones/:id', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updateZone);
router.delete('/zones/:id', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), deleteZone);
router.put('/config', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updateConfig);

export default router;
