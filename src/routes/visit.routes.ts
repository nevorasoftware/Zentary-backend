import { Router } from 'express';
import {
  getVisits,
  createVisit,
  cancelVisit,
  updateVisit,
  scanQRToken,
  confirmEntry,
  registerExit,
  getActiveInsideVisits,
  quickEntry,
  getDynamicQR,
  getVisitorDocument,
} from '../controllers/visit.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

// Real-time Garita Stay Control & Metrics (must be before :id)
router.get('/active-inside', getActiveInsideVisits);
router.post('/quick-entry', quickEntry);
router.post('/scan-qr', scanQRToken);

// General Visits Query & Management
router.get('/', getVisits);
router.post('/', createVisit);

// Item Specific Actions
router.get('/:id/qr-dynamic', getDynamicQR);
router.put('/:id', updateVisit);
router.patch('/:id/cancel', cancelVisit);
router.post('/:id/confirm-entry', confirmEntry);
router.post('/:id/exit', registerExit);
router.get('/:id/visitor-document', getVisitorDocument);

export default router;
