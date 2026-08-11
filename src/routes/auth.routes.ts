import { Router } from 'express';
import { register, login, getProfile, updateFrequentConfig } from '../controllers/auth.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.get('/profile', authenticateToken, getProfile);
router.put('/frequent-config', authenticateToken, updateFrequentConfig);

export default router;
