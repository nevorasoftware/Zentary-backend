import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import crypto from 'crypto';
import { sendWhatsAppMessage } from '../services/whatsapp.service.js';
import { generateDynamicQrToken, verifyDynamicQrToken } from '../services/qr.service.js';
import { logAuditEvent } from '../services/audit.service.js';

/**
 * Helper to resolve tenantId from request or database
 */
async function resolveTenantId(req: AuthRequest): Promise<string | null> {
  if (req.tenantId) return req.tenantId;

  if (req.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { tenantId: true, communityId: true },
    });
    return user?.tenantId || user?.communityId || null;
  }

  return null;
}

/**
 * GET /api/visits
 * Obtains visits list with multi-tenant isolation, role permissions & filters
 */
export const getVisits = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { category, status, search } = req.query;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const tenantId = await resolveTenantId(req);
    const whereCondition: any = {};

    if (tenantId && userRole !== 'SUPER_ADMIN') {
      whereCondition.OR = [
        { tenantId },
        { resident: { tenantId } },
        { resident: { communityId: tenantId } },
      ];
    }

    if (userRole === 'RESIDENT') {
      whereCondition.residentId = userId;
    }

    if (category) {
      whereCondition.category = category as string;
    }

    if (status) {
      whereCondition.status = status as string;
    }

    if (search && typeof search === 'string') {
      const q = search.trim();
      whereCondition.AND = [
        ...(whereCondition.AND || []),
        {
          OR: [
            { visitorName: { contains: q, mode: 'insensitive' } },
            { visitorPhone: { contains: q, mode: 'insensitive' } },
            { vehiclePlate: { contains: q, mode: 'insensitive' } },
            { house: { unitNumber: { contains: q, mode: 'insensitive' } } },
            { resident: { fullName: { contains: q, mode: 'insensitive' } } },
          ],
        },
      ];
    }

    const visits = await prisma.visit.findMany({
      where: whereCondition,
      include: {
        house: {
          select: { unitNumber: true, block: true },
        },
        resident: {
          select: {
            fullName: true,
            phone: true,
            whatsapp: true,
            tenant: { select: { name: true } },
            house: { select: { unitNumber: true, block: true } },
            property: { select: { unitNumber: true, block: true } },
          },
        },
        guard: {
          select: { fullName: true },
        },
        tokens: {
          where: { isRevoked: false, expiresAt: { gt: new Date() } },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, count: visits.length, visits });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener visitas', error: error.message });
  }
};

/**
 * POST /api/visits
 * Resident creates a new visitor invitation with FastPass & Dynamic QR
 */
export const createVisit = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { visitorName, visitorPhone, visitorDni, hasVehicle, vehiclePlate, visitDate, validFrom, notes, houseId, maxDurationHours } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });
    if (!visitorName) return res.status(400).json({ success: false, message: 'Nombre del visitante requerido.' });

    // Obtain Resident user & details
    let resident = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: { include: { settings: true } },
        house: true,
        property: true,
      },
    });

    if (!resident && req.user?.email) {
      resident = await prisma.user.findUnique({
        where: { email: req.user.email },
        include: {
          tenant: { include: { settings: true } },
          house: true,
          property: true,
        },
      });
    }

    if (!resident) return res.status(404).json({ success: false, message: 'Usuario residente no encontrado.' });

    const tenantId = req.tenantId || resident.tenantId || resident.communityId || 'tenant-default-zentary';
    const effectiveHouseId = houseId || resident.houseId || null;

    // Calculate dates & time window
    const targetDate = visitDate ? new Date(visitDate) : new Date();
    let validFromDate = new Date(targetDate);

    if (validFrom) {
      const [hours, minutes] = validFrom.split(':');
      if (hours && minutes) {
        validFromDate.setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0);
      }
    }

    const publicToken = crypto.randomUUID();

    const visit = await prisma.visit.create({
      data: {
        tenantId,
        residentId: resident.id,
        houseId: effectiveHouseId,
        visitorName,
        visitorPhone: visitorPhone || null,
        visitorDni: visitorDni || null,
        hasVehicle: Boolean(hasVehicle || vehiclePlate),
        vehiclePlate: vehiclePlate || null,
        status: 'PENDIENTE_REGISTRO',
        category: 'EN_CURSO',
        validFrom: validFromDate,
        maxDurationHours: maxDurationHours ? parseInt(maxDurationHours, 10) : (resident.tenant?.settings?.visitorMaxDurationHours || 4),
        notes: notes || null,
        publicToken,
      },
      include: {
        resident: {
          select: {
            fullName: true,
            tenant: { select: { name: true } },
            house: { select: { unitNumber: true, block: true } },
          },
        },
        house: {
          select: { unitNumber: true, block: true },
        },
      },
    });

    // Generate initial Dynamic QR Token
    let qrData = null;
    try {
      qrData = await generateDynamicQrToken(visit.id, tenantId, resident.id);
    } catch (qrErr) {
      console.warn('[VISIT_CREATE] Warning generating dynamic QR:', qrErr);
    }

    // Public URL for Visitor FastPass
    const baseUrl = process.env.PUBLIC_APP_URL || 'https://zentary-backend-production.up.railway.app';
    const publicUrl = `${baseUrl}/visit/${publicToken}`;

    // WhatsApp Notification Formatter
    const communityName = resident.tenant?.name || 'Residencial Zentary';
    const residentName = resident.fullName;
    const targetHouseUnit = visit.house ? `${visit.house.block ? visit.house.block + ' ' : ''}${visit.house.unitNumber}` : (resident.house ? `${resident.house.unitNumber}` : '');
    const whatsappMessage = `${residentName} te envió un FastPass digital para ingresar a ${communityName}${targetHouseUnit ? ` (${targetHouseUnit})` : ''}.\n\n*Muéstrale al oficial de garita el código QR en este enlace:*\n${publicUrl}`;

    let whatsappResult = null;
    if (visitorPhone) {
      whatsappResult = await sendWhatsAppMessage(visitorPhone, whatsappMessage);
    }

    // Audit log
    await logAuditEvent({
      tenantId,
      userId: resident.id,
      action: 'VISIT_CREATE',
      entity: 'Visit',
      entityId: visit.id,
      details: `Pase de visita creado para ${visitorName} por ${residentName}`,
    });

    return res.status(201).json({
      success: true,
      message: 'Invitación y FastPass creados exitosamente',
      visit,
      publicToken,
      publicUrl,
      whatsappMessage,
      whatsappResult,
      dynamicQr: qrData,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al crear la invitación', error: error.message });
  }
};

/**
 * GET /api/visits/:id/qr-dynamic
 * Generates or refreshes a fresh dynamic cryptographic QR for a visit
 */
export const getDynamicQR = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const visit = await prisma.visit.findUnique({
      where: { id },
      include: { tenant: { include: { settings: true } } },
    });

    if (!visit) {
      return res.status(404).json({ success: false, message: 'Visita no encontrada.' });
    }

    const tenantId = visit.tenantId || (await resolveTenantId(req)) || 'tenant-default-zentary';
    const qrResult = await generateDynamicQrToken(visit.id, tenantId, visit.residentId);

    return res.json({
      success: true,
      visitId: visit.id,
      ...qrResult,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al generar QR dinámico', error: error.message });
  }
};

/**
 * POST /api/visits/scan-qr
 * Security Guard scans or submits dynamic QR token to validate access
 */
export const scanQRToken = async (req: AuthRequest, res: Response) => {
  try {
    const { token } = req.body;
    const guardTenantId = await resolveTenantId(req);

    if (!token) {
      return res.status(400).json({ success: false, message: 'Código QR de token requerido.' });
    }

    // Cryptographic validation via QR Service
    const verification = await verifyDynamicQrToken(token, guardTenantId || undefined);

    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        valid: false,
        code: verification.code || 'INVALID_TOKEN',
        message: verification.message || 'Código QR inválido.',
      });
    }

    const visitId = verification.visitId;
    if (!visitId) {
      return res.status(404).json({ success: false, message: 'Visita asociada al token no encontrada.' });
    }

    const visit = await prisma.visit.findUnique({
      where: { id: visitId },
      include: {
        house: true,
        resident: {
          select: {
            fullName: true,
            phone: true,
            whatsapp: true,
            tenant: { select: { name: true } },
            house: { select: { unitNumber: true, block: true } },
            property: { select: { unitNumber: true, block: true } },
          },
        },
      },
    });

    if (!visit) {
      return res.status(404).json({
        success: false,
        valid: false,
        code: 'VISIT_NOT_FOUND',
        message: 'La visita asociada ya no existe.',
      });
    }

    // Check visit status
    if (visit.status === 'INGRESADA' || (visit.entryDate && !visit.exitDate)) {
      return res.status(400).json({
        success: false,
        valid: false,
        code: 'ALREADY_ENTERED',
        message: '⚠️ Esta visita ya se encuentra DENTRO de la residencial.',
        visit,
      });
    }

    if (visit.status === 'COMPLETED') {
      return res.status(400).json({
        success: false,
        valid: false,
        code: 'VISIT_COMPLETED',
        message: '⚠️ Este pase ya completó su ciclo de entrada y salida.',
      });
    }

    if (visit.status === 'CANCELADA') {
      return res.status(400).json({
        success: false,
        valid: false,
        code: 'CANCELLED_VISIT',
        message: '❌ Esta invitación fue cancelada por el residente.',
      });
    }

    if (visit.status === 'VENCIDA') {
      return res.status(400).json({
        success: false,
        valid: false,
        code: 'EXPIRED_VISIT',
        message: '❌ Esta invitación ha vencido.',
      });
    }

    // Time window check (tolerance of 30 min prior)
    const now = new Date();
    if (visit.validFrom) {
      const allowedStart = new Date(visit.validFrom.getTime() - 30 * 60 * 1000);
      if (now < allowedStart) {
        const timeStr = visit.validFrom.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
        return res.status(400).json({
          success: false,
          valid: false,
          code: 'TIME_NOT_STARTED',
          message: `⚠️ Esta visita aún no está habilitada. Hora de inicio: ${timeStr}`,
        });
      }
    }

    const houseLabel = visit.house ? `${visit.house.block ? visit.house.block + ' ' : ''}${visit.house.unitNumber}` : (visit.resident?.house ? `${visit.resident.house.unitNumber}` : 'N/A');

    return res.json({
      success: true,
      valid: true,
      message: '✅ VISITANTE AUTORIZADO',
      visit: {
        id: visit.id,
        visitorName: visit.visitorName,
        visitorPhone: visit.visitorPhone,
        visitorDni: visit.visitorDni || 'No registrado',
        documentType: visit.documentType || 'DUI',
        documentNumber: visit.documentNumber || visit.visitorDni || 'N/A',
        documentPhotoUrl: visit.documentPhotoUrl,
        hasVehicle: visit.hasVehicle,
        vehiclePlate: visit.vehiclePlate || 'N/A',
        vehicleModel: visit.vehicleModel || 'N/A',
        vehicleColor: visit.vehicleColor || 'N/A',
        residentName: visit.resident?.fullName,
        residentPhone: visit.resident?.phone,
        communityName: visit.resident?.tenant?.name || 'Residencial Zentary',
        propertyUnit: houseLabel,
        validFrom: visit.validFrom,
        maxDurationHours: visit.maxDurationHours || 4,
        notes: visit.notes,
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
    const { gateName, vehiclePlate, notes } = req.body;

    const visit = await prisma.visit.findUnique({
      where: { id },
      include: {
        resident: { select: { fullName: true, phone: true } },
        house: true,
      },
    });

    if (!visit) return res.status(404).json({ success: false, message: 'Visita no encontrada.' });

    if (visit.status === 'INGRESADA' && !visit.exitDate) {
      return res.status(400).json({ success: false, message: 'Esta visita ya se encuentra registrada como ingresada.' });
    }

    const now = new Date();

    const [updatedVisit] = await prisma.$transaction([
      prisma.visit.update({
        where: { id },
        data: {
          status: 'INGRESADA',
          entryDate: now,
          guardId: guardId || null,
          gateName: gateName || 'Garita Principal',
          vehiclePlate: vehiclePlate || visit.vehiclePlate,
          notes: notes ? (visit.notes ? `${visit.notes} | ${notes}` : notes) : visit.notes,
        },
      }),
      prisma.visitToken.updateMany({
        where: { visitId: id },
        data: { isRevoked: true, usedAt: now },
      }),
    ]);

    const entryTimeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    const notificationMessage = `🔔 Tu visita ${visit.visitorName} ha ingresado a las ${entryTimeStr}.`;

    // Send WhatsApp to Resident
    if (visit.resident?.phone) {
      const residentWhatsAppMsg = `🔔 Hola ${visit.resident.fullName || 'Residente'}.\n\nTu visita *${visit.visitorName}* ha ingresado a la comunidad por *${gateName || 'Garita Principal'}* a las *${entryTimeStr}*.`;
      sendWhatsAppMessage(visit.resident.phone, residentWhatsAppMsg).catch((err) => {
        console.error('Error enviando WhatsApp de ingreso:', err);
      });
    }

    // Audit log
    await logAuditEvent({
      tenantId: visit.tenantId || (await resolveTenantId(req)) || 'tenant-default-zentary',
      userId: guardId,
      action: 'VISIT_ENTRY',
      entity: 'Visit',
      entityId: visit.id,
      details: `Entrada registrada para ${visit.visitorName} en ${gateName || 'Garita Principal'}`,
    });

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
    return res.status(500).json({ success: false, message: 'Error al confirmar ingreso', error: error.message });
  }
};

/**
 * POST /api/visits/:id/exit
 * Guard registers visitor exit (Sección 18: SALIDA DEL VISITANTE)
 */
export const registerExit = async (req: AuthRequest, res: Response) => {
  try {
    const guardId = req.user?.id;
    const { id } = req.params;
    const { notes } = req.body;

    const visit = await prisma.visit.findUnique({
      where: { id },
      include: {
        resident: { select: { fullName: true, phone: true } },
        house: true,
      },
    });

    if (!visit) return res.status(404).json({ success: false, message: 'Visita no encontrada.' });

    if (!visit.entryDate) {
      return res.status(400).json({
        success: false,
        message: 'No se puede registrar salida de una visita que no ha registrado entrada.',
      });
    }

    if (visit.exitDate) {
      return res.status(400).json({
        success: false,
        message: 'La salida de esta visita ya había sido registrada previamente.',
      });
    }

    const now = new Date();
    const durationMinutes = Math.max(1, Math.round((now.getTime() - visit.entryDate.getTime()) / 60000));
    const hours = Math.floor(durationMinutes / 60);
    const mins = durationMinutes % 60;
    const durationFormatted = hours > 0 ? `${hours}h ${mins}m` : `${mins} min`;

    const updatedVisit = await prisma.visit.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        exitDate: now,
        durationMinutes,
        notes: notes ? (visit.notes ? `${visit.notes} | Salida: ${notes}` : `Salida: ${notes}`) : visit.notes,
      },
    });

    const exitTimeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    // Send WhatsApp to Resident notifying exit
    if (visit.resident?.phone) {
      const exitWhatsAppMsg = `🚪 Hola ${visit.resident.fullName || 'Residente'}.\n\nTu visita *${visit.visitorName}* ha salido de la comunidad a las *${exitTimeStr}*.\n⏱️ Tiempo de permanencia: *${durationFormatted}*.`;
      sendWhatsAppMessage(visit.resident.phone, exitWhatsAppMsg).catch((err) => {
        console.error('Error enviando WhatsApp de salida:', err);
      });
    }

    // Audit log
    await logAuditEvent({
      tenantId: visit.tenantId || (await resolveTenantId(req)) || 'tenant-default-zentary',
      userId: guardId,
      action: 'VISIT_EXIT',
      entity: 'Visit',
      entityId: visit.id,
      details: `Salida registrada para ${visit.visitorName}. Permanencia: ${durationFormatted}`,
    });

    return res.json({
      success: true,
      message: 'Salida registrada exitosamente.',
      visit: updatedVisit,
      durationMinutes,
      durationFormatted,
      exitTime: exitTimeStr,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al registrar salida', error: error.message });
  }
};

/**
 * GET /api/visits/active-inside
 * Real-time monitoring for Garita & Stay Control (Sección 17 & 39)
 */
export const getActiveInsideVisits = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);

    const whereTenant: any = {};
    if (tenantId && req.user?.role !== 'SUPER_ADMIN') {
      whereTenant.tenantId = tenantId;
    }

    // 1. Visitors currently inside (entryDate is set, exitDate is null, status is INGRESADA)
    const insideVisits = await prisma.visit.findMany({
      where: {
        ...whereTenant,
        status: 'INGRESADA',
        entryDate: { not: null },
        exitDate: null,
      },
      include: {
        house: { select: { unitNumber: true, block: true } },
        resident: {
          select: {
            fullName: true,
            phone: true,
            whatsapp: true,
            house: { select: { unitNumber: true, block: true } },
          },
        },
        guard: { select: { fullName: true } },
      },
      orderBy: { entryDate: 'asc' },
    });

    const now = new Date();

    // Map each visit with real-time stay metrics
    let totalExceeded = 0;
    const activeVisits = insideVisits.map((v) => {
      const entryTime = new Date(v.entryDate!).getTime();
      const elapsedMinutes = Math.floor((now.getTime() - entryTime) / 60000);
      const maxHours = v.maxDurationHours || 4;
      const maxMinutes = maxHours * 60;
      const remainingMinutes = maxMinutes - elapsedMinutes;
      const isExceeded = elapsedMinutes > maxMinutes;
      const exceededMinutes = Math.max(0, elapsedMinutes - maxMinutes);

      if (isExceeded) totalExceeded++;

      let severity: 'NORMAL' | 'WARNING' | 'EXCEEDED' = 'NORMAL';
      if (isExceeded) {
        severity = 'EXCEEDED';
      } else if (remainingMinutes <= 30) {
        severity = 'WARNING';
      }

      const houseNumber = v.house ? `${v.house.block ? v.house.block + ' ' : ''}${v.house.unitNumber}` : (v.resident?.house ? `${v.resident.house.unitNumber}` : 'N/A');

      return {
        id: v.id,
        visitorName: v.visitorName,
        visitorPhone: v.visitorPhone,
        visitorDni: v.visitorDni,
        vehiclePlate: v.vehiclePlate,
        entryType: v.entryType || 'VISIT',
        entryDate: v.entryDate,
        gateName: v.gateName || 'Garita Principal',
        residentName: v.resident?.fullName,
        residentPhone: v.resident?.phone,
        houseUnit: houseNumber,
        maxDurationHours: maxHours,
        elapsedMinutes,
        remainingMinutes,
        isExceeded,
        exceededMinutes,
        severity,
      };
    });

    // 2. Expected today: visits scheduled for today not yet entered
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const expectedToday = await prisma.visit.findMany({
      where: {
        ...whereTenant,
        status: { in: ['PENDIENTE_REGISTRO', 'DATOS_COMPLETADOS'] },
        validFrom: { gte: startOfDay, lte: endOfDay },
      },
      include: {
        house: { select: { unitNumber: true, block: true } },
        resident: { select: { fullName: true, phone: true } },
      },
      orderBy: { validFrom: 'asc' },
    });

    return res.json({
      success: true,
      summary: {
        totalInside: activeVisits.length,
        totalExceeded,
        totalExpectedToday: expectedToday.length,
      },
      activeVisits,
      expectedToday,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al consultar permanencia en garita', error: error.message });
  }
};

/**
 * POST /api/visits/quick-entry
 * Fast Gate Registration (Direct entry without prior FastPass - Deliveries, Services, Taxis)
 */
export const quickEntry = async (req: AuthRequest, res: Response) => {
  try {
    const guardId = req.user?.id;
    const tenantId = (await resolveTenantId(req)) || 'tenant-default-zentary';
    const { visitorName, visitorDni, visitorPhone, hasVehicle, vehiclePlate, houseId, unitNumber, entryType, notes, gateName, maxDurationHours } = req.body;

    if (!visitorName) {
      return res.status(400).json({ success: false, message: 'Nombre del visitante o conductor requerido.' });
    }

    // Resolve house and resident if specified
    let targetHouse = null;
    let targetResidentId: string | null = null;

    if (houseId) {
      targetHouse = await prisma.house.findUnique({
        where: { id: houseId },
        include: { residents: { take: 1 } },
      });
      if (targetHouse?.residents?.[0]) {
        targetResidentId = targetHouse.residents[0].id;
      }
    } else if (unitNumber) {
      targetHouse = await prisma.house.findFirst({
        where: { tenantId, unitNumber: { equals: unitNumber, mode: 'insensitive' } },
        include: { residents: { take: 1 } },
      });
      if (targetHouse?.residents?.[0]) {
        targetResidentId = targetHouse.residents[0].id;
      }
    }

    // If no resident found, attach to first resident in tenant or system user
    if (!targetResidentId) {
      const fallbackUser = await prisma.user.findFirst({
        where: { tenantId, role: 'RESIDENT' },
      });
      targetResidentId = fallbackUser?.id || guardId || 'system';
    }

    const now = new Date();
    const effectiveEntryType = entryType || (vehiclePlate ? 'VEHICULAR' : 'PEATONAL');
    const effectiveMaxHours = maxDurationHours ? parseInt(maxDurationHours, 10) : (effectiveEntryType === 'DELIVERY' ? 1 : 4);

    const visit = await prisma.visit.create({
      data: {
        tenantId,
        residentId: targetResidentId!,
        houseId: targetHouse?.id || null,
        visitorName,
        visitorDni: visitorDni || null,
        visitorPhone: visitorPhone || null,
        hasVehicle: Boolean(hasVehicle || vehiclePlate),
        vehiclePlate: vehiclePlate || null,
        entryType: effectiveEntryType,
        status: 'INGRESADA',
        entryDate: now,
        guardId: guardId || null,
        gateName: gateName || 'Garita Principal',
        maxDurationHours: effectiveMaxHours,
        notes: notes || `Ingreso directo en garita (${effectiveEntryType})`,
      },
      include: {
        house: true,
        resident: { select: { fullName: true, phone: true } },
      },
    });

    // Notify resident if available
    if (visit.resident?.phone) {
      const entryTimeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      const msg = `🔔 Aviso de Garita: Ha ingresado *${visitorName}* (${effectiveEntryType}) hacia tu vivienda a las *${entryTimeStr}*.`;
      sendWhatsAppMessage(visit.resident.phone, msg).catch((err) => console.error('Error enviando WhatsApp:', err));
    }

    // Audit log
    await logAuditEvent({
      tenantId,
      userId: guardId,
      action: 'QUICK_ENTRY',
      entity: 'Visit',
      entityId: visit.id,
      details: `Ingreso directo registrado por garita: ${visitorName} (${effectiveEntryType})`,
    });

    return res.status(201).json({
      success: true,
      message: 'Ingreso rápido registrado exitosamente.',
      visit,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error en registro directo de garita', error: error.message });
  }
};

/**
 * PATCH /api/visits/:id/cancel
 * Resident or Admin cancels invitation
 */
export const cancelVisit = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;

    const visit = await prisma.visit.findUnique({ where: { id } });
    if (!visit) return res.status(404).json({ success: false, message: 'Visita no encontrada.' });

    if (visit.residentId !== userId && !['ADMIN', 'RESIDENTIAL_ADMIN', 'SUPER_ADMIN'].includes(req.user?.role || '')) {
      return res.status(403).json({ success: false, message: 'No tienes permiso para cancelar esta visita.' });
    }

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

    await logAuditEvent({
      tenantId: visit.tenantId || (await resolveTenantId(req)) || 'tenant-default-zentary',
      userId,
      action: 'VISIT_CANCEL',
      entity: 'Visit',
      entityId: id,
      details: `Invitación cancelada para ${visit.visitorName}`,
    });

    return res.json({ success: true, message: 'La invitación ha sido cancelada exitosamente.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al cancelar la visita', error: error.message });
  }
};

/**
 * PUT /api/visits/:id
 * Resident edits invitation before entry
 */
export const updateVisit = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { visitorName, visitorPhone, visitDate, validFrom, vehiclePlate, notes } = req.body;

    const visit = await prisma.visit.findUnique({ where: { id } });
    if (!visit) return res.status(404).json({ success: false, message: 'Visita no encontrada.' });

    if (visit.residentId !== userId && !['ADMIN', 'RESIDENTIAL_ADMIN', 'SUPER_ADMIN'].includes(req.user?.role || '')) {
      return res.status(403).json({ success: false, message: 'No tienes permiso para modificar esta visita.' });
    }

    if (visit.status !== 'PENDIENTE_REGISTRO') {
      return res.status(400).json({
        success: false,
        message: 'No se puede modificar una visita que ya ha completado su registro o ha ingresado.',
      });
    }

    const updated = await prisma.visit.update({
      where: { id },
      data: {
        visitorName: visitorName || visit.visitorName,
        visitorPhone: visitorPhone || visit.visitorPhone,
        vehiclePlate: vehiclePlate !== undefined ? vehiclePlate : visit.vehiclePlate,
        validFrom: validFrom ? new Date(validFrom) : visit.validFrom,
        notes: notes !== undefined ? notes : visit.notes,
      },
    });

    return res.json({ success: true, message: 'Invitación actualizada exitosamente.', visit: updated });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar la visita', error: error.message });
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
