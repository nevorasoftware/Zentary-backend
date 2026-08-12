import { Router } from 'express';
import authRoutes from './auth.routes.js';
import visitRoutes from './visit.routes.js';
import parcelRoutes from './parcel.routes.js';
import pqrsRoutes from './pqrs.routes.js';
import paymentRoutes from './payment.routes.js';
import adminRoutes from './admin.routes.js';
import announcementRoutes from './announcement.routes.js';
import publicRoutes from './public.routes.js';

import loggerRoutes from './logger.routes.js';

const router = Router();

router.use('/auth', authRoutes);
router.use('/visits', visitRoutes);
router.use('/parcels', parcelRoutes);
router.use('/pqrs', pqrsRoutes);
router.use('/payments', paymentRoutes);
router.use('/admin', adminRoutes);
router.use('/announcements', announcementRoutes);
router.use('/public', publicRoutes);
router.use('/logs', loggerRoutes);

export default router;
