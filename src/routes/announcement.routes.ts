import { Router } from 'express';
import { getAnnouncements, createAnnouncement, deleteAnnouncement } from '../controllers/announcement.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', getAnnouncements);
router.post('/', authenticateToken, createAnnouncement);
router.delete('/:id', authenticateToken, deleteAnnouncement);

export default router;
