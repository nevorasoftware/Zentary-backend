import { Router } from 'express';
import { getPayments, createPaymentRequest, processPaymentGateway, handlePaymentWebhook } from '../controllers/payment.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

// Webhook endpoint does not require user bearer token
router.post('/webhook', handlePaymentWebhook);

// Protected routes
router.get('/', authenticateToken, getPayments);
router.post('/', authenticateToken, createPaymentRequest);
router.post('/process', authenticateToken, processPaymentGateway);

export default router;
