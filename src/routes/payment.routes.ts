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
import { authenticateToken } from '../middlewares/auth.middleware.js';

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
router.get('/admin/all', authenticateToken, getAllPaymentsAdmin);
router.get('/admin/financial-summary', authenticateToken, getFinancialSummary);
router.post('/admin/create-charge', authenticateToken, createPaymentRequest);
router.post('/admin/apply-late-fees', authenticateToken, applyLateFees);
router.post('/admin/register-manual-payment', authenticateToken, registerManualPayment);
router.patch('/admin/:id/status', authenticateToken, updatePaymentStatusAdmin);

export default router;
