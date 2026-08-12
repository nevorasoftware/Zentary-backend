import { Router } from 'express';
import {
  getVisits,
  createVisit,
  cancelVisit,
  updateVisit,
  scanQRToken,
  confirmEntry,
  getVisitorDocument,
} from '../controllers/visit.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

// Resident & Guard Endpoints
router.get('/', getVisits);
router.post('/', createVisit);
router.put('/:id', updateVisit);
router.patch('/:id/cancel', cancelVisit);

// Guard Specific Access Endpoints
router.post('/scan-qr', scanQRToken);
router.post('/:id/confirm-entry', confirmEntry);
router.get('/:id/visitor-document', getVisitorDocument);

export default router;
