import { Router } from 'express';
import { getUsers, toggleUserAccess, getDashboardStats } from '../controllers/admin.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/users', getUsers);
router.patch('/users/:userId/access', toggleUserAccess);
router.get('/stats', getDashboardStats);

export default router;
