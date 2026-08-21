import { Router } from 'express';
import {
  checkEmail,
  register,
  login,
  getProfile,
  updateProfile,
  changePassword,
  renewSession,
  updatePushToken,
} from '../controllers/auth.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/check-email', checkEmail);
router.post('/register', register);
router.post('/login', login);
router.get('/profile', authenticateToken, getProfile);
router.put('/profile', authenticateToken, updateProfile);
router.post('/change-password', authenticateToken, changePassword);
router.post('/renew-session', authenticateToken, renewSession);
router.post('/push-token', authenticateToken, updatePushToken);

export default router;
