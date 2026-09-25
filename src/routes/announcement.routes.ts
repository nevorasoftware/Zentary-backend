import { Router } from 'express';
import {
  getAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from '../controllers/announcement.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', authenticateToken, getAnnouncements);
router.post('/', authenticateToken, createAnnouncement);
router.put('/:id', authenticateToken, updateAnnouncement);
router.delete('/:id', authenticateToken, deleteAnnouncement);

export default router;
