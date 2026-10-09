import { Router } from 'express';
import {
  getPayments,
  getAccountStatement,
  getAllPaymentsAdmin,
  getFinancialSummary,
  createPaymentRequest,
  applyLateFees,
  registerManualPayment,
  updatePaymentStatusAdmin,
  createWompi3DsTransaction,
  render3DsRedirect,
  handlePaymentWebhook,
} from '../controllers/payment.controller.js';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';

const router = Router();

// Public / Gateway Callback Endpoints (No Bearer Token required)
router.post('/webhook', handlePaymentWebhook);
router.get('/3ds-redirect', render3DsRedirect);

// Protected Resident Endpoints
router.get('/', authenticateToken, getPayments);
router.get('/statement', authenticateToken, getAccountStatement);
router.post('/', authenticateToken, createPaymentRequest);
router.post('/wompi/create-3ds', authenticateToken, createWompi3DsTransaction);

// Protected Admin Endpoints (Phase 4 Finanzas)
router.get('/admin/all', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), getAllPaymentsAdmin);
router.get('/admin/financial-summary', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), getFinancialSummary);
router.post('/admin/create-charge', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), createPaymentRequest);
router.post('/admin/apply-late-fees', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), applyLateFees);
router.post('/admin/register-manual-payment', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), registerManualPayment);
router.patch('/admin/:id/status', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updatePaymentStatusAdmin);

export default router;
