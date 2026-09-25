import { Router } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';
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
router.get('/admin', authenticateToken, getAdminAmenities);
router.post('/admin', authenticateToken, createAmenity);
router.put('/admin/:id', authenticateToken, updateAmenity);
router.delete('/admin/:id', authenticateToken, deleteAmenity);
router.get('/admin/reservations', authenticateToken, getAdminReservations);
router.patch('/admin/reservations/:id/status', authenticateToken, updateReservationStatusAdmin);

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
