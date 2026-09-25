import { Router } from 'express';
import {
  listHouses,
  getHouseById,
  createHouse,
  updateHouse,
  deleteHouse,
} from '../controllers/house.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/', listHouses);
router.get('/:id', getHouseById);
router.post('/', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), createHouse);
router.put('/:id', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updateHouse);
router.delete('/:id', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), deleteHouse);

export default router;
