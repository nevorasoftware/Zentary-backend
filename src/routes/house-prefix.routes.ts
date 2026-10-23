import { Router } from 'express';
import {
  listHousePrefixes,
  createHousePrefix,
  updateHousePrefix,
  deleteHousePrefix,
} from '../controllers/house-prefix.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/', listHousePrefixes);
router.post('/', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), createHousePrefix);
router.put('/:id', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updateHousePrefix);
router.delete('/:id', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), deleteHousePrefix);

export default router;
