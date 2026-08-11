import { Router } from 'express';
import { getPqrsList, createPqrs, getPqrsDetail, sendPqrsMessage } from '../controllers/pqrs.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/', getPqrsList);
router.post('/', createPqrs);
router.get('/:id', getPqrsDetail);
router.post('/:id/messages', sendPqrsMessage);

export default router;
