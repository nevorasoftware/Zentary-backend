import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import crypto from 'crypto';
import { sendWhatsAppMessage } from '../services/whatsapp.service.js';

/**
 * GET /api/visits
 * Obtains visits list from database based on user role (Resident or Guard/Admin)
 */
export const getVisits = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { category, status } = req.query;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const whereCondition: any = {};

    if (userRole === 'RESIDENT') {
      whereCondition.residentId = userId;
    } else if (userRole === 'GUARD' || userRole === 'ADMIN') {
      // Guards see visits belonging to their community
      const currentUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { communityId: true },
      });
      if (currentUser?.communityId) {
        whereCondition.resident = { communityId: currentUser.communityId };
      }
    }

    if (category) {
      whereCondition.category = category as string;
    }

    if (status) {
      whereCondition.status = status as string;
    }

    const visits = await prisma.visit.findMany({
      where: whereCondition,
      include: {
        resident: {
          select: {
            fullName: true,
            phone: true,
            community: { select: { name: true } },
            property: { select: { unitNumber: true, block: true } },
          },
        },
        guard: {
          select: { fullName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, visits });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener visitas', error: error.message });
  }
};

/**
 * POST /api/visits
 * Resident creates a new visitor invitation
 */
export const createVisit = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { visitorName, visitorPhone, visitDate, validFrom, notes } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });
    if (!visitorName) return res.status(400).json({ success: false, message: 'Nombre del visitante requerido.' });

    // Obtain Resident user & community details
    let resident = await prisma.user.findUnique({
      where: { id: userId },
      include: { community: true },
    });

    if (!resident && req.user?.email) {
      resident = await prisma.user.findUnique({
        where: { email: req.user.email },
        include: { community: true },
      });
    }

    if (!resident) {
      resident = await prisma.user.findFirst({
        where: { isActive: true },
        include: { community: true },
      });
    }

    if (!resident) return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });

    // Generate unique random public token (UUID or crypto random)
    const publicToken = crypto.randomUUID();

    // Calculate dates & time window
    const targetDate = visitDate ? new Date(visitDate) : new Date();
    let validFromDate = new Date(targetDate);

    if (validFrom) {
      const [hours, minutes] = validFrom.split(':');
      if (hours && minutes) {
        validFromDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
      }
    }

    const visit = await prisma.visit.create({
      data: {
        residentId: userId,
        visitorName,
        visitorPhone: visitorPhone || null,
        status: 'PENDIENTE_REGISTRO',
        category: 'EN_CURSO',
        validFrom: validFromDate,
        notes: notes || null,
        publicToken,
      },
      include: {
        resident: {
          select: {
            fullName: true,
            community: { select: { name: true } },
          },
        },
      },
    });

    // Public URL for Visitor
    const baseUrl = process.env.PUBLIC_APP_URL || 'https://zentary-backend-production.up.railway.app';
    const publicUrl = `${baseUrl}/visit/${publicToken}`;

    // WhatsApp Pre-formatted Message
    const formattedDate = targetDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
    const formattedTime = validFromDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const communityName = resident.community?.name || 'nuestro complejo residencial';

    const whatsappMessage = `Hola, ${visitorName}.\n\nHas recibido una invitación de parte de ${resident.fullName} para ingresar a ${communityName} el día ${formattedDate} a partir de las ${formattedTime}.\n\nPara completar tu registro de visitante y obtener tu código de acceso QR, ingresa al siguiente enlace:\n\n${publicUrl}\n\nNo necesitas crear una cuenta para realizar este registro.`;

    // Automatically send WhatsApp message to visitor via Meta Cloud API
    let whatsappResult = null;
    if (visitorPhone) {
      console.log(`📱 [MOBILE APP LOG] [INVITATION_CREATE] Solicitud de envío de WhatsApp a ${visitorPhone} para visitante ${visitorName}`);
      whatsappResult = await sendWhatsAppMessage(visitorPhone, whatsappMessage);
      if (whatsappResult.success) {
        console.log(`✅ [MOBILE APP LOG] [WHATSAPP_SUCCESS] Mensaje entregado a Meta Cloud API. ID: ${whatsappResult.data?.messages?.[0]?.id}`);
      } else {
        console.error(`❌ [MOBILE APP LOG] [WHATSAPP_FAILURE] Error de Meta API al enviar a ${visitorPhone}:`, whatsappResult.error, JSON.stringify(whatsappResult.data || {}));
      }
    }

    return res.status(201).json({
      success: true,
      message: 'Invitación creada exitosamente',
      visit,
      publicToken,
      publicUrl,
      whatsappMessage,
      whatsappResult,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al crear la invitación', error: error.message });
  }
};

/**
 * PATCH /api/visits/:id/cancel
 * Resident cancels invitation
 */
export const cancelVisit = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const visit = await prisma.visit.findUnique({ where: { id } });
    if (!visit) return res.status(404).json({ success: false, message: 'Visita no encontrada.' });

    if (visit.residentId !== userId && req.user?.role !== 'ADMIN') {
      return res.status(403).json({ success: false, message: 'No tienes permiso para cancelar esta visita.' });
    }

    // Transaction to update status to CANCELADA and revoke all tokens
    await prisma.$transaction([
      prisma.visit.update({
        where: { id },
        data: { status: 'CANCELADA' },
      }),
      prisma.visitToken.updateMany({
        where: { visitId: id },
        data: { isRevoked: true },
      }),
    ]);

    return res.json({ success: true, message: 'La invitación ha sido cancelada exitosamente.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al cancelar la visita', error: error.message });
  }
};

/**
 * PUT /api/visits/:id
 * Resident edits invitation (allowed if status is PENDIENTE_REGISTRO)
 */
export const updateVisit = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { visitorName, visitorPhone, visitDate, validFrom } = req.body;

    const visit = await prisma.visit.findUnique({ where: { id } });
    if (!visit) return res.status(404).json({ success: false, message: 'Visita no encontrada.' });

    if (visit.residentId !== userId) {
      return res.status(403).json({ success: false, message: 'No tienes permiso para modificar esta visita.' });
    }

    if (visit.status !== 'PENDIENTE_REGISTRO') {
      return res.status(400).json({
        success: false,
        message: 'No se puede modificar una visita que ya ha completado el registro o ha ingresado.',
      });
    }

    const updated = await prisma.visit.update({
      where: { id },
      data: {
        visitorName: visitorName || visit.visitorName,
        visitorPhone: visitorPhone || visit.visitorPhone,
        validFrom: validFrom ? new Date(validFrom) : visit.validFrom,
      },
    });

    return res.json({ success: true, message: 'Invitación actualizada exitosamente.', visit: updated });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar la visita', error: error.message });
  }
};

/**
 * POST /api/visits/scan-qr
 * Security Guard scans or submits dynamic QR token to validate access
 */
export const scanQRToken = async (req: AuthRequest, res: Response) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ success: false, message: 'Código QR de token requerido.' });
    }

    // Step A: Find VisitToken in database
    const tokenRecord = await prisma.visitToken.findUnique({
      where: { token },
      include: {
        visit: {
          include: {
            resident: {
              select: {
                fullName: true,
                phone: true,
                community: { select: { name: true } },
                property: { select: { unitNumber: true, block: true } },
              },
            },
          },
        },
      },
    });

    if (!tokenRecord) {
      return res.status(404).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: '❌ Código QR inválido o inexistente.',
      });
    }

    const { visit } = tokenRecord;

    // Step B: Check token expiration & revocation
    const now = new Date();
    if (tokenRecord.isRevoked || tokenRecord.expiresAt < now) {
      return res.status(400).json({
        success: false,
        code: 'EXPIRED_TOKEN',
        message: '⏱️ Código QR expirado. El código rota cada 15 minutos.',
      });
    }

    // Step C: Check visit status
    if (visit.status === 'INGRESADA' || visit.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        code: 'ALREADY_ENTERED',
        message: '⚠️ Esta visita ya fue registrada e ingresó previamente.',
      });
    }

    if (visit.status === 'CANCELADA') {
      return res.status(400).json({
        success: false,
        code: 'CANCELLED_VISIT',
        message: '❌ Esta invitación fue cancelada por el residente.',
      });
    }

    if (visit.status === 'VENCIDA') {
      return res.status(400).json({
        success: false,
        code: 'EXPIRED_VISIT',
        message: '❌ Esta invitación ha vencido.',
      });
    }

    // Step D: Check time window
    if (visit.validFrom) {
      const allowedStart = new Date(visit.validFrom.getTime() - 15 * 60 * 1000); // 15 min early tolerance
      if (now < allowedStart) {
        const timeStr = visit.validFrom.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        return res.status(400).json({
          success: false,
          code: 'TIME_NOT_STARTED',
          message: `⚠️ Esta visita todavía no está habilitada. Hora autorizada: ${timeStr}`,
        });
      }
    }

    // Everything valid -> Return complete visitor information to guard
    return res.json({
      success: true,
      valid: true,
      message: '✅ VISITANTE AUTORIZADO',
      visit: {
        id: visit.id,
        visitorName: visit.visitorName,
        visitorPhone: visit.visitorPhone,
        documentType: visit.documentType || 'DUI',
        documentNumber: visit.documentNumber || 'No especificado',
        documentPhotoUrl: visit.documentPhotoUrl,
        hasVehicle: visit.hasVehicle,
        vehiclePlate: visit.vehiclePlate || 'N/A',
        vehicleModel: visit.vehicleModel || 'N/A',
        vehicleColor: visit.vehicleColor || 'N/A',
        residentName: visit.resident?.fullName,
        communityName: visit.resident?.community?.name || 'Residencial Zentary',
        propertyUnit: visit.resident?.property ? `${visit.resident.property.block || ''} ${visit.resident.property.unitNumber}`.trim() : 'N/A',
        validFrom: visit.validFrom,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al escanear código QR', error: error.message });
  }
};

/**
 * POST /api/visits/:id/confirm-entry
 * Guard confirms authorized entry after reviewing visitor data
 */
export const confirmEntry = async (req: AuthRequest, res: Response) => {
  try {
    const guardId = req.user?.id;
    const { id } = req.params;
    const { gateName } = req.body;

    const visit = await prisma.visit.findUnique({
      where: { id },
      include: {
        resident: { select: { fullName: true, phone: true } },
      },
    });

    if (!visit) return res.status(404).json({ success: false, message: 'Visita no encontrada.' });

    if (visit.status === 'INGRESADA' || visit.status === 'COMPLETED') {
      return res.status(400).json({ success: false, message: 'Esta visita ya fue marcada como INGRESADA.' });
    }

    const now = new Date();

    // Transaction: Mark visit as INGRESADA, record entry date & guard, invalidate ALL tokens
    const [updatedVisit] = await prisma.$transaction([
      prisma.visit.update({
        where: { id },
        data: {
          status: 'INGRESADA',
          entryDate: now,
          guardId: guardId || null,
          gateName: gateName || 'Puerta Principal',
        },
      }),
      prisma.visitToken.updateMany({
        where: { visitId: id },
        data: { isRevoked: true, usedAt: now },
      }),
    ]);

    const entryTimeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const notificationMessage = `🔔 Tu visita ${visit.visitorName} ha ingresado a las ${entryTimeStr}.`;

    // Send automated WhatsApp notification to Resident when visit enters
    if (visit.resident?.phone) {
      const residentWhatsAppMsg = `🔔 Hola ${visit.resident.fullName || 'Residente'}.\n\nTu visita *${visit.visitorName}* ha ingresado a la comunidad a las *${entryTimeStr}*.`;
      sendWhatsAppMessage(visit.resident.phone, residentWhatsAppMsg).catch((err) => {
        console.error('Error enviando mensaje de WhatsApp de ingreso al residente:', err);
      });
    }

    return res.json({
      success: true,
      message: 'Ingreso verificado y registrado exitosamente.',
      visit: updatedVisit,
      notification: {
        title: '🔔 Tu visita ha ingresado',
        body: notificationMessage,
        visitorName: visit.visitorName,
        entryTime: entryTimeStr,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al confirmar ingreso de la visita', error: error.message });
  }
};

/**
 * GET /api/visits/:id/visitor-document
 * Guard securely views visitor identification document photo
 */
export const getVisitorDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const visit = await prisma.visit.findUnique({
      where: { id },
      select: {
        visitorName: true,
        documentType: true,
        documentNumber: true,
        documentPhotoUrl: true,
      },
    });

    if (!visit) return res.status(404).json({ success: false, message: 'Visita no encontrada.' });

    return res.json({
      success: true,
      visitorName: visit.visitorName,
      documentType: visit.documentType,
      documentNumber: visit.documentNumber,
      documentPhotoUrl: visit.documentPhotoUrl,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al consultar documento del visitante', error: error.message });
  }
};
