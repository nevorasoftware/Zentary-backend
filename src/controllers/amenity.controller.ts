import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { createWompi3DsPurchase } from '../services/wompi.service.js';

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://zentary-backend-production.up.railway.app';

// Helper to convert "HH:MM" to total minutes for easy comparison
const timeToMinutes = (timeStr: string): number => {
  const [hours, minutes] = timeStr.split(':').map((num) => parseInt(num, 10));
  return hours * 60 + minutes;
};

// Helper to get Spanish day name from Date
const getSpanishDayName = (date: Date): string => {
  const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  return days[date.getDay()];
};

/**
 * GET /api/amenities/admin
 * Obtener todas las amenidades para el portal administrativo
 */
export const getAdminAmenities = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const communityId = user?.communityId;

    const amenities = await prisma.amenity.findMany({
      where: communityId ? { communityId } : {},
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: { reservations: true },
        },
      },
    });

    return res.json({ success: true, amenities });
  } catch (error: any) {
    console.error('Error al obtener amenidades (admin):', error);
    return res.status(500).json({ success: false, message: 'Error al obtener amenidades', error: error.message });
  }
};

/**
 * POST /api/amenities/admin
 * Crear una nueva amenidad desde la consola administrativa
 */
export const createAmenity = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const { name, type, imageUrl, price, maxReservationTime, availableDays, startTime, endTime } = req.body;

    if (!name || !type) {
      return res.status(400).json({ success: false, message: 'El nombre y el tipo de amenidad son obligatorios.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    let communityId = user?.communityId;

    if (!communityId) {
      const defaultCommunity = await prisma.community.findFirst();
      communityId = defaultCommunity?.id;
    }

    if (!communityId) {
      return res.status(400).json({ success: false, message: 'No se encontró una residencial asociada.' });
    }

    const parsedPrice = parseFloat(price) >= 0 ? parseFloat(price) : 0;
    const parsedMaxTime = parseInt(maxReservationTime, 10) > 0 ? parseInt(maxReservationTime, 10) : 4;
    const cleanStartTime = startTime || '08:00';
    const cleanEndTime = endTime || '22:00';

    if (timeToMinutes(cleanEndTime) <= timeToMinutes(cleanStartTime)) {
      return res.status(400).json({
        success: false,
        message: 'La hora final de disponibilidad debe ser posterior a la hora de inicio.',
      });
    }

    const amenity = await prisma.amenity.create({
      data: {
        communityId,
        name: name.trim(),
        type: type.trim(),
        imageUrl: imageUrl || 'https://images.unsplash.com/photo-1576013551627-0cc20b96c2a7?w=600',
        price: parsedPrice,
        maxReservationTime: parsedMaxTime,
        availableDays: availableDays || 'Lunes,Martes,Miércoles,Jueves,Viernes,Sábado,Domingo',
        startTime: cleanStartTime,
        endTime: cleanEndTime,
        active: true,
      },
    });

    return res.status(201).json({ success: true, message: 'Amenidad registrada exitosamente.', amenity });
  } catch (error: any) {
    console.error('Error al crear amenidad:', error);
    return res.status(500).json({ success: false, message: 'Error al registrar amenidad', error: error.message });
  }
};

/**
 * PUT /api/amenities/admin/:id
 * Editar amenidad existente
 */
export const updateAmenity = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, type, imageUrl, price, maxReservationTime, availableDays, startTime, endTime, active } = req.body;

    const existing = await prisma.amenity.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Amenidad no encontrada.' });
    }

    const cleanStartTime = startTime || existing.startTime;
    const cleanEndTime = endTime || existing.endTime;

    if (timeToMinutes(cleanEndTime) <= timeToMinutes(cleanStartTime)) {
      return res.status(400).json({
        success: false,
        message: 'La hora final de disponibilidad debe ser posterior a la hora de inicio.',
      });
    }

    const updated = await prisma.amenity.update({
      where: { id },
      data: {
        name: name ? name.trim() : existing.name,
        type: type ? type.trim() : existing.type,
        imageUrl: imageUrl !== undefined ? imageUrl : existing.imageUrl,
        price: price !== undefined ? parseFloat(price) : existing.price,
        maxReservationTime: maxReservationTime ? parseInt(maxReservationTime, 10) : existing.maxReservationTime,
        availableDays: availableDays || existing.availableDays,
        startTime: cleanStartTime,
        endTime: cleanEndTime,
        active: active !== undefined ? active : existing.active,
      },
    });

    return res.json({ success: true, message: 'Amenidad actualizada exitosamente.', amenity: updated });
  } catch (error: any) {
    console.error('Error al actualizar amenidad:', error);
    return res.status(500).json({ success: false, message: 'Error al actualizar la amenidad', error: error.message });
  }
};

/**
 * DELETE /api/amenities/admin/:id
 * Alternar estado activo / eliminar amenidad
 */
export const deleteAmenity = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.amenity.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Amenidad no encontrada.' });

    await prisma.amenity.delete({ where: { id } });
    return res.json({ success: true, message: 'Amenidad eliminada correctamente.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al eliminar la amenidad', error: error.message });
  }
};

/**
 * GET /api/amenities/admin/reservations
 * Obtener reservas por rango de fechas (Calendario Semanal del Admin)
 */
export const getAdminReservations = async (req: AuthRequest, res: Response) => {
  try {
    const { amenityId, startDate, endDate } = req.query;

    const whereClause: any = {};

    if (amenityId && typeof amenityId === 'string' && amenityId !== 'ALL') {
      whereClause.amenityId = amenityId;
    }

    if (startDate && endDate) {
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      end.setHours(23, 59, 59, 999);
      whereClause.reservationDate = {
        gte: start,
        lte: end,
      };
    }

    const reservations = await prisma.amenityReservation.findMany({
      where: whereClause,
      orderBy: [{ reservationDate: 'asc' }, { startTime: 'asc' }],
      include: {
        amenity: {
          select: { name: true, type: true, price: true },
        },
        resident: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            property: { select: { unitNumber: true, block: true } },
          },
        },
      },
    });

    return res.json({ success: true, reservations });
  } catch (error: any) {
    console.error('Error al obtener reservas (admin):', error);
    return res.status(500).json({ success: false, message: 'Error al obtener calendario de reservas', error: error.message });
  }
};

// =========================================================================
// ENDPOINTS RESIDENTE (APLICACIÓN MÓVIL)
// =========================================================================

/**
 * GET /api/amenities
 * Obtener amenidades de la residencial del residente autenticado
 */
export const getResidentAmenities = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    let communityId = user?.communityId;

    if (!communityId) {
      const defaultComm = await prisma.community.findFirst();
      communityId = defaultComm?.id;
    }

    const amenities = await prisma.amenity.findMany({
      where: {
        communityId,
        active: true,
      },
      orderBy: { name: 'asc' },
    });

    return res.json({ success: true, amenities });
  } catch (error: any) {
    console.error('Error al obtener amenidades del residente:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener amenidades', error: error.message });
  }
};

/**
 * GET /api/amenities/:id/availability
 * Consulta de horarios ocupados en una fecha determinada
 */
export const getAmenityAvailability = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    if (!date || typeof date !== 'string') {
      return res.status(400).json({ success: false, message: 'La fecha (date) es requerida en formato YYYY-MM-DD.' });
    }

    const amenity = await prisma.amenity.findUnique({ where: { id } });
    if (!amenity) return res.status(404).json({ success: false, message: 'Amenidad no encontrada.' });

    const targetDate = new Date(date);
    const dayStart = new Date(targetDate);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(targetDate);
    dayEnd.setHours(23, 59, 59, 999);

    // Obtener reservas activas en esa fecha
    const reservations = await prisma.amenityReservation.findMany({
      where: {
        amenityId: id,
        reservationDate: {
          gte: dayStart,
          lte: dayEnd,
        },
        reservationStatus: { in: ['PENDING', 'CONFIRMED'] },
      },
      select: {
        id: true,
        startTime: true,
        endTime: true,
        reservationStatus: true,
      },
    });

    const dayName = getSpanishDayName(targetDate);
    const isDayAvailable = amenity.availableDays.toLowerCase().includes(dayName.toLowerCase());

    return res.json({
      success: true,
      amenity: {
        id: amenity.id,
        name: amenity.name,
        type: amenity.type,
        price: amenity.price,
        maxReservationTime: amenity.maxReservationTime,
        startTime: amenity.startTime,
        endTime: amenity.endTime,
        availableDays: amenity.availableDays,
        isDayAvailable,
      },
      bookedSlots: reservations,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al consultar disponibilidad', error: error.message });
  }
};

/**
 * POST /api/amenities/reserve
 * Crear una reservación de amenidad (Validación estricta en servidor)
 */
export const createReservation = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const { amenityId, reservationDate, startTime, endTime, notes } = req.body;

    if (!amenityId || !reservationDate || !startTime || !endTime) {
      return res.status(400).json({ success: false, message: 'Amenidad, fecha, hora inicial y hora final son requeridos.' });
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });

    const amenity = await prisma.amenity.findUnique({ where: { id: amenityId } });
    if (!amenity || !amenity.active) {
      return res.status(404).json({ success: false, message: 'La amenidad no existe o no se encuentra activa.' });
    }

    // 1. REGLA DE SEGURIDAD: Misma residencial
    if (user.communityId && amenity.communityId !== user.communityId) {
      return res.status(403).json({
        success: false,
        message: 'No tienes autorización para reservar amenidades de otra residencial.',
      });
    }

    const parsedDate = new Date(reservationDate);
    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Fecha de reservación inválida.' });
    }

    // 2. REGLA DÍAS PERMITIDOS
    const dayName = getSpanishDayName(parsedDate);
    if (!amenity.availableDays.toLowerCase().includes(dayName.toLowerCase())) {
      return res.status(400).json({
        success: false,
        message: `La amenidad no está disponible los días ${dayName}. Días permitidos: ${amenity.availableDays}.`,
      });
    }

    // 3. REGLA HORARIO DE OPERACIÓN
    const startMins = timeToMinutes(startTime);
    const endMins = timeToMinutes(endTime);
    const amenityStartMins = timeToMinutes(amenity.startTime);
    const amenityEndMins = timeToMinutes(amenity.endTime);

    if (endMins <= startMins) {
      return res.status(400).json({ success: false, message: 'La hora final debe ser posterior a la hora inicial.' });
    }

    if (startMins < amenityStartMins || endMins > amenityEndMins) {
      return res.status(400).json({
        success: false,
        message: `El horario debe estar dentro de la disponibilidad de la amenidad (${amenity.startTime} - ${amenity.endTime}).`,
      });
    }

    // 4. REGLA TIEMPO MÁXIMO DE RESERVA
    const durationHours = (endMins - startMins) / 60;
    if (durationHours > amenity.maxReservationTime) {
      return res.status(400).json({
        success: false,
        message: `La duración solicitada (${durationHours}h) excede el tiempo máximo de reserva permitido (${amenity.maxReservationTime}h).`,
      });
    }

    // 5. REGLA CONTROL DE DISPONIBILIDAD Y TRASLAPE DE HORARIOS (CONCURRENCIA EN BD)
    const dayStart = new Date(parsedDate);
    dayStart.setHours(0, 0, 0, 0);

    const dayEnd = new Date(parsedDate);
    dayEnd.setHours(23, 59, 59, 999);

    const existingReservations = await prisma.amenityReservation.findMany({
      where: {
        amenityId,
        reservationDate: {
          gte: dayStart,
          lte: dayEnd,
        },
        reservationStatus: { in: ['PENDING', 'CONFIRMED'] },
      },
    });

    const isOverlapping = existingReservations.some((existing) => {
      const eStart = timeToMinutes(existing.startTime);
      const eEnd = timeToMinutes(existing.endTime);

      // Overlap formula: NOT (newEnd <= existingStart OR newStart >= existingEnd)
      return !(endMins <= eStart || startMins >= eEnd);
    });

    if (isOverlapping) {
      return res.status(409).json({
        success: false,
        message: 'El horario seleccionado se cruza con otra reserva ya existente. Por favor selecciona otro horario.',
      });
    }

    // 6. ASIGNACIÓN DE ESTADO Y PAGO
    const isFree = amenity.price === 0;
    const reservationStatus = isFree ? 'CONFIRMED' : 'PENDING';
    const paymentStatus = isFree ? 'NOT_REQUIRED' : 'PENDING';

    const reservation = await prisma.amenityReservation.create({
      data: {
        amenityId: amenity.id,
        communityId: amenity.communityId,
        residentId: userId,
        reservationDate: parsedDate,
        startTime,
        endTime,
        price: amenity.price,
        reservationStatus,
        paymentStatus,
        notes: notes || null,
      },
      include: {
        amenity: { select: { name: true, type: true, imageUrl: true } },
      },
    });

    console.log(`✅ [RESERVACIÓN CREADA] ID: ${reservation.id} - Status: ${reservationStatus} - Pago: ${paymentStatus}`);

    return res.status(201).json({
      success: true,
      message: isFree ? '¡Reserva confirmada exitosamente!' : 'Reserva registrada. Procede con el pago para confirmar.',
      requirePayment: !isFree,
      reservation,
    });
  } catch (error: any) {
    console.error('Error al crear reserva:', error);
    return res.status(500).json({ success: false, message: 'Error al procesar la reserva', error: error.message });
  }
};

/**
 * POST /api/amenities/reserve/:id/wompi-3ds
 * Inicia el pago de Wompi 3DS para una reserva de amenidad con costo
 */
export const createReservationWompiPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const {
      numeroTarjeta,
      cvv,
      mesVencimiento,
      anioVencimiento,
      nombre,
      apellido,
      email,
      telefono,
      ciudad,
      direccion,
    } = req.body;

    const reservation = await prisma.amenityReservation.findUnique({
      where: { id },
      include: {
        amenity: true,
        resident: { select: { fullName: true, email: true, phone: true } },
      },
    });

    if (!reservation) {
      return res.status(404).json({ success: false, message: 'Reserva no encontrada.' });
    }

    if (reservation.reservationStatus === 'CONFIRMED' && reservation.paymentStatus === 'PAID') {
      return res.status(400).json({ success: false, message: 'Esta reserva ya se encuentra pagada y confirmada.' });
    }

    const cleanCardNumber = String(numeroTarjeta).replace(/\s+/g, '');
    const cleanPhone = String(telefono || reservation.resident.phone || '70000000').replace(/[^\d]/g, '');
    const residentEmail = email || reservation.resident.email || 'notificaciones@zentary.app';
    const residentName = nombre || reservation.resident.fullName.split(' ')[0] || 'Residente';
    const residentLastName = apellido || reservation.resident.fullName.split(' ').slice(1).join(' ') || 'Zentary';

    const wompiPayload = {
      tarjetaCreditoDebido: {
        numeroTarjeta: cleanCardNumber,
        cvv: String(cvv),
        mesVencimiento: parseInt(String(mesVencimiento), 10),
        anioVencimiento: parseInt(String(anioVencimiento), 10),
      },
      monto: reservation.price,
      nombreProducto: `Reserva Amenidad: ${reservation.amenity.name}`,
      nombreEnlacePago: `Reserva Amenidad: ${reservation.amenity.name}`,
      descripcion: `Reserva de ${reservation.amenity.name} (${reservation.startTime} - ${reservation.endTime})`,
      configuracion: {
        emailsNotificacion: residentEmail,
        urlWebhook: `${PUBLIC_APP_URL}/api/payments/webhook`,
        telefonosNotificacion: cleanPhone,
        notificarTransaccionCliente: true,
      },
      urlRedirect: `${PUBLIC_APP_URL}/api/amenities/wompi-redirect?reservationId=${reservation.id}`,
      nombre: residentName,
      apellido: residentLastName,
      email: residentEmail,
      ciudad: ciudad || 'San Salvador',
      direccion: direccion || 'Residencial Zentary',
      idPais: 'SV',
      idRegion: 'SV-SS',
      codigoPostal: '01101',
      telefono: cleanPhone,
      datosAdicionales: {
        reservationId: reservation.id,
        amenityId: reservation.amenityId,
        residentId: reservation.residentId,
      },
    };

    console.log(`💳 [WOMPI RESERVATION 3DS] Iniciando pago para reserva ${reservation.id}...`);
    const wompiResData = await createWompi3DsPurchase(wompiPayload);

    const transactionId = wompiResData.idTransaccion || `WOMPI-RES-${Date.now()}`;
    const redirectUrl = wompiResData.urlCompletarPago3Ds || `${PUBLIC_APP_URL}/api/amenities/wompi-redirect?reservationId=${reservation.id}`;

    await prisma.amenityReservation.update({
      where: { id: reservation.id },
      data: {
        paymentReference: transactionId,
      },
    });

    return res.json({
      success: true,
      message: 'Transacción de reservación iniciada en Wompi.',
      idTransaccion: transactionId,
      urlCompletarPago3Ds: redirectUrl,
    });
  } catch (error: any) {
    console.error('Error en pago Wompi de reserva:', error);
    return res.status(500).json({ success: false, message: 'Error al procesar pago de la reserva', error: error.message });
  }
};

/**
 * GET /api/amenities/wompi-redirect
 * Redirección tras pago 3DS de reservación
 */
export const renderWompiReservationRedirect = async (req: Request, res: Response) => {
  const { reservationId } = req.query;

  try {
    if (reservationId && typeof reservationId === 'string') {
      await prisma.amenityReservation.update({
        where: { id: reservationId },
        data: {
          reservationStatus: 'CONFIRMED',
          paymentStatus: 'PAID',
        },
      });
      console.log(`✅ [RESERVACIÓN CONFIRMADA VÍA WOMPI 3DS] Reserva ${reservationId} actualizada a CONFIRMED & PAID.`);
    }

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zentary | Reserva Confirmada</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Outfit', sans-serif; }
    body { background: #0A0F1F; color: #F8FAFC; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; text-align: center; }
    .card { background: #141A2E; border: 2px solid #6203FF; border-radius: 28px; padding: 36px 24px; max-width: 400px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    .icon { width: 72px; height: 72px; background: rgba(255, 207, 54, 0.15); border: 2px solid #FFCF36; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px auto; color: #FFCF36; font-size: 36px; font-weight: bold; }
    h1 { font-size: 22px; font-weight: 800; color: #FFFFFF; margin-bottom: 8px; }
    p { font-size: 14px; color: #CBD5E1; margin-bottom: 24px; line-height: 1.5; }
    .btn { display: inline-block; width: 100%; padding: 14px; background: #1877F2; border: none; border-radius: 14px; color: #FFFFFF; font-size: 15px; font-weight: 800; text-decoration: none; cursor: pointer; border-bottom: 4px solid #0B3C91; }
  </style>
  <script>
    function returnToApp() {
      window.location.href = 'zentary://amenities';
      setTimeout(function() {
        try { window.close(); } catch(e) {}
      }, 1000);
    }
    setTimeout(returnToApp, 2000);
  </script>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>¡Reserva Confirmada Exitosamente!</h1>
    <p>El pago con Wompi ha sido verificado correctamente y tu espacio común ha sido reservado.</p>
    <button onclick="returnToApp()" class="btn">Volver a la Aplicación</button>
  </div>
</body>
</html>`;

    return res.send(html);
  } catch (err: any) {
    return res.status(500).send(`<h2>Error en confirmación de reserva: ${err.message}</h2>`);
  }
};
