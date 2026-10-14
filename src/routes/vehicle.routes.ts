import { Router } from 'express';
import {
  listVehicles,
  createVehicle,
  updateVehicle,
  deleteVehicle,
} from '../controllers/vehicle.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/', listVehicles);
router.post('/', requireRole('RESIDENT', 'RESIDENTIAL_ADMIN', 'ADMIN'), createVehicle);
router.put('/:id', requireRole('RESIDENT', 'RESIDENTIAL_ADMIN', 'ADMIN'), updateVehicle);
router.delete('/:id', requireRole('RESIDENT', 'RESIDENTIAL_ADMIN', 'ADMIN'), deleteVehicle);

export default router;
