import express, { Router } from 'express';
import {
  listHouses,
  getHouseById,
  createHouse,
  updateHouse,
  deleteHouse,
} from '../controllers/house.controller.js';
import { exportHouses, importHouses, importBodyErrorHandler } from '../controllers/house-import.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/', listHouses);
// Importar / exportar CSV: antes de '/:id'
router.get('/export', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), exportHouses);
router.post(
  '/import',
  requireRole('RESIDENTIAL_ADMIN', 'ADMIN'),
  express.text({ type: '*/*', limit: '2mb' }),
  importHouses,
  importBodyErrorHandler,
);
router.get('/:id', getHouseById);
router.post('/', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), createHouse);
router.put('/:id', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updateHouse);
router.delete('/:id', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), deleteHouse);

export default router;
