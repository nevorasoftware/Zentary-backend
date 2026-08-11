import { Router } from 'express';
import { getParcels, createParcel, markParcelPickedUp } from '../controllers/parcel.controller.js';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateToken);

router.get('/', getParcels);
router.post('/', createParcel);
router.patch('/:id/pickup', markParcelPickedUp);

export default router;
