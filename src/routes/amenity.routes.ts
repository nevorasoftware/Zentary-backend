import { Router } from 'express';
import { authenticateToken, requireRole } from '../middlewares/auth.middleware.js';
import {
  getAdminAmenities,
  createAmenity,
  updateAmenity,
  deleteAmenity,
  getAdminReservations,
  updateReservationStatusAdmin,
  getResidentAmenities,
  getAmenityAvailability,
  createReservation,
  cancelReservation,
  createReservationWompiPayment,
  renderWompiReservationRedirect,
} from '../controllers/amenity.controller.js';

const router = Router();

// -------------------------------------------------------------
// Rutas Administrativas (Web Admin Console)
// -------------------------------------------------------------
router.get('/admin', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), getAdminAmenities);
router.post('/admin', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), createAmenity);
router.put('/admin/:id', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updateAmenity);
router.delete('/admin/:id', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), deleteAmenity);
router.get('/admin/reservations', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), getAdminReservations);
router.patch('/admin/reservations/:id/status', authenticateToken, requireRole('RESIDENTIAL_ADMIN', 'ADMIN'), updateReservationStatusAdmin);

// -------------------------------------------------------------
// Rutas de Aplicación Móvil (Residentes)
// -------------------------------------------------------------
router.get('/', authenticateToken, getResidentAmenities);
router.get('/:id/availability', getAmenityAvailability);
router.post('/reserve', authenticateToken, createReservation);
router.patch('/reservations/:id/cancel', authenticateToken, cancelReservation);
router.post('/reserve/:id/wompi-3ds', authenticateToken, createReservationWompiPayment);
router.get('/wompi-redirect', renderWompiReservationRedirect);

export default router;
