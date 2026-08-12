import { Router } from 'express';
import {
  getPublicVisitDetails,
  registerVisitorData,
  getOrRotateDynamicQR,
} from '../controllers/public.controller.js';

const router = Router();

// Public Visitor Endpoints (No Auth Header required)
router.get('/visit/:publicToken', getPublicVisitDetails);
router.post('/visit/:publicToken/register', registerVisitorData);
router.get('/visit/:publicToken/qr', getOrRotateDynamicQR);

export default router;
