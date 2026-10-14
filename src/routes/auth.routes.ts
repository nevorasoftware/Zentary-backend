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
} from '../controllers/auth.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    code: 'TOO_MANY_REQUESTS',
    message: 'Demasiados intentos. Inténtalo de nuevo más tarde.',
  },
});

router.post('/check-email', authLimiter, checkEmail);
router.post('/login', authLimiter, login);
router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, updateProfile);
router.post('/change-password', authenticateToken, changePassword);
router.post('/renew-session', authenticateToken, renewSession);
router.post('/push-token', authenticateToken, updatePushToken);

export default router;
