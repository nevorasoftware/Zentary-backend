import { Router } from 'express';
import {
  getPqrsList,
  createPqrs,
  getPqrsDetail,
  sendPqrsMessage,
  updatePqrsStatus,
  assignPqrsStaff,
} from '../controllers/pqrs.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/', getPqrsList);
router.post('/', createPqrs);
router.get('/:id', getPqrsDetail);
router.post('/:id/messages', sendPqrsMessage);
router.patch('/:id/status', updatePqrsStatus);
router.patch('/:id/assign', requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), assignPqrsStaff);

export default router;
