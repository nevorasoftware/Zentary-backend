import { Router } from 'express';
import { getVisits, createVisit, updateVisitStatus } from '../controllers/visit.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/', getVisits);
router.post('/', createVisit);
router.patch('/:id/status', updateVisitStatus);

export default router;
