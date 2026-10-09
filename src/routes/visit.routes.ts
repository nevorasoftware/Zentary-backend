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
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

// Real-time Garita Stay Control & Metrics (must be before :id)
router.get('/active-inside', requireRole('RESIDENTIAL_ADMIN', 'ADMIN', 'SECURITY_ADMIN', 'GUARD'), getActiveInsideVisits);
router.post('/quick-entry', requireRole('RESIDENTIAL_ADMIN', 'ADMIN', 'SECURITY_ADMIN', 'GUARD'), quickEntry);
router.post('/scan-qr', requireRole('RESIDENTIAL_ADMIN', 'ADMIN', 'SECURITY_ADMIN', 'GUARD'), scanQRToken);

// General Visits Query & Management
router.get('/', getVisits);
router.post('/', createVisit);

// Item Specific Actions
router.get('/:id/qr-dynamic', getDynamicQR);
router.put('/:id', updateVisit);
router.patch('/:id/cancel', cancelVisit);
router.post('/:id/confirm-entry', requireRole('RESIDENTIAL_ADMIN', 'ADMIN', 'SECURITY_ADMIN', 'GUARD'), confirmEntry);
router.post('/:id/exit', requireRole('RESIDENTIAL_ADMIN', 'ADMIN', 'SECURITY_ADMIN', 'GUARD'), registerExit);
router.get('/:id/visitor-document', getVisitorDocument);

export default router;
