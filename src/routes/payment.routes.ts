import { Router } from 'express';
import {
  getPayments,
  getAllPaymentsAdmin,
  createPaymentRequest,
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
router.post('/', authenticateToken, createPaymentRequest);
router.post('/wompi/create-3ds', authenticateToken, createWompi3DsTransaction);

// Protected Admin Endpoints
router.get('/admin/all', authenticateToken, getAllPaymentsAdmin);
router.post('/admin/create-charge', authenticateToken, createPaymentRequest);

export default router;
