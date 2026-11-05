import { Router } from 'express';
import { getDocuments, createDocument, deleteDocument } from '../controllers/document.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

router.get('/', authenticateToken, getDocuments);
router.post('/', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), createDocument);
router.delete('/:id', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), deleteDocument);

export default router;
