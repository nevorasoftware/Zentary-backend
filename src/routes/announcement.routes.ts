import { Router } from 'express';
import {
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '../controllers/announcement.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', authenticateToken, getAnnouncements);
router.post('/', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), createAnnouncement);
router.put('/:id', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updateAnnouncement);
router.delete('/:id', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), deleteAnnouncement);

export default router;
