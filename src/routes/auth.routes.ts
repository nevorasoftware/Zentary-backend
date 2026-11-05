import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  checkEmail,
  login,
  getProfile,
  updateProfile,
  changePassword,
  renewSession,
  updatePushToken,
  deleteAccount,
  getDeleteAccountSummary,
} from '../controllers/auth.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

const limitMessage = {
  success: false,
  code: 'TOO_MANY_REQUESTS',
  message: 'Demasiados intentos. Inténtalo de nuevo más tarde.',
};

const checkEmailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: limitMessage,
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: limitMessage,
});

const deleteAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: limitMessage,
});

router.post('/check-email', checkEmailLimiter, checkEmail);
router.post('/login', loginLimiter, login);
router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, updateProfile);
router.post('/change-password', authenticateToken, changePassword);
router.post('/renew-session', authenticateToken, renewSession);
router.post('/push-token', authenticateToken, updatePushToken);
router.get('/delete-account/summary', authenticateToken, getDeleteAccountSummary);
router.post('/delete-account', authenticateToken, deleteAccountLimiter, deleteAccount);

export default router;
