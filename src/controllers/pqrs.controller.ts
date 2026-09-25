import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { sendPushNotification } from '../services/pushNotification.service.js';
import { logAuditEvent } from '../services/audit.service.js';

// Helper to resolve tenantId across headers, token, user record or fallback
const resolveTenantId = async (req: AuthRequest): Promise<string | undefined> => {
  if (req.tenantId) return req.tenantId;
  if (req.user?.tenantId) return req.user.tenantId;
  const headerTenant = req.headers['x-tenant-id'] as string;
  if (headerTenant) return headerTenant;
  if (req.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { tenantId: true, communityId: true },
    });
    if (user?.tenantId) return user.tenantId;
    if (user?.communityId) return user.communityId;
  }
  const defaultTenant = await prisma.tenant.findFirst({ select: { id: true } });
  return defaultTenant?.id;
};

/**
 * GET /api/pqrs
 * Obtener lista de tickets PQRS con aislamiento multi-tenant y filtros
 */
export const getPqrsList = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const tenantId = await resolveTenantId(req);
    const { search, status, category, priority, all } = req.query;

    const isAll = String(all).toLowerCase() === 'true';

    let user = null;
    if (userId) {
      user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user && req.user?.email) {
        user = await prisma.user.findUnique({ where: { email: req.user.email } });
      }
    }

    if (!user) {
      user = await prisma.user.findFirst({ where: { role: 'RESIDENT' } });
    }

    const isStaffOrAdmin =
      isAll ||
      userRole === 'ADMIN' ||
      userRole === 'RESIDENTIAL_ADMIN' ||
      userRole === 'GUARD' ||
      user?.role === 'ADMIN' ||
      user?.role === 'RESIDENTIAL_ADMIN' ||
      userId === 'admin-demo-1';

    const whereCondition: any = {};

    if (tenantId) {
      whereCondition.tenantId = tenantId;
    }

    if (!isStaffOrAdmin && user) {
      whereCondition.residentId = user.id;
    }

    if (status && typeof status === 'string' && status !== 'ALL') {
      whereCondition.status = status;
    }

    if (category && typeof category === 'string' && category !== 'ALL') {
      whereCondition.category = category;
    }

    if (priority && typeof priority === 'string' && priority !== 'ALL') {
      whereCondition.priority = priority.toUpperCase();
    }

    if (search && typeof search === 'string') {
      whereCondition.OR = [
        { subject: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { resident: { fullName: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const pqrsList = await prisma.pqrs.findMany({
      where: whereCondition,
      include: {
        resident: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            pushToken: true,
            property: {
              select: {
                unitNumber: true,
                block: true,
              },
            },
          },
        },
        house: {
          select: {
            id: true,
            unitNumber: true,
            block: true,
          },
        },
        assignedToUser: {
          select: {
            id: true,
            fullName: true,
            role: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: { id: true, fullName: true, role: true, avatarUrl: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, pqrsList });
  } catch (error: any) {
    console.error('[getPqrsList Error]:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener PQRS', error: error.message });
  }
};

/**
 * POST /api/pqrs
 * Crear un nuevo ticket PQRS
 */
export const createPqrs = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const tenantId = await resolveTenantId(req);
    const { category, subject, description, priority = 'MEDIA', attachments } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });
    if (!subject || !description) {
      return res.status(400).json({ success: false, message: 'Asunto y descripción son requeridos.' });
    }

    let user = await prisma.user.findUnique({
      where: { id: userId },
      include: { house: true, property: true },
    });
    if (!user && req.user?.email) {
      user = await prisma.user.findUnique({
        where: { email: req.user.email },
        include: { house: true, property: true },
      });
    }

    if (!user) {
      user = await prisma.user.findFirst({
        where: { role: 'RESIDENT' },
        include: { house: true, property: true },
      });
    }

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'No existe un usuario activo en la base de datos para asociar la PQRS.',
      });
    }

    const validCategory = category && ['PETICION', 'QUEJA', 'RECLAMO', 'SUGERENCIA'].includes(category.toUpperCase())
      ? category.toUpperCase()
      : 'PETICION';

    const validPriority = priority && ['BAJA', 'MEDIA', 'ALTA', 'URGENTE'].includes(priority.toUpperCase())
      ? priority.toUpperCase()
      : 'MEDIA';

    const pqrs = await prisma.pqrs.create({
      data: {
        tenantId: tenantId || user.tenantId,
        residentId: user.id,
        houseId: user.houseId || null,
        category: validCategory as any,
        priority: validPriority,
        subject: subject.trim(),
        description: description.trim(),
        attachments: typeof attachments === 'string' ? attachments : Array.isArray(attachments) ? attachments.join(',') : null,
        status: 'OPEN',
      },
    });

    await prisma.pqrsMessage.create({
      data: {
        pqrsId: pqrs.id,
        senderId: user.id,
        message: description.trim(),
        isStaff: user.role === 'ADMIN' || user.role === 'RESIDENTIAL_ADMIN' || user.role === 'GUARD',
      },
    });

    const createdPqrs = await prisma.pqrs.findUnique({
      where: { id: pqrs.id },
      include: {
        resident: {
          select: {
            id: true,
            fullName: true,
            email: true,
            property: { select: { unitNumber: true, block: true } },
          },
        },
        house: { select: { unitNumber: true, block: true } },
        messages: {
          include: {
            sender: { select: { id: true, fullName: true, role: true } },
          },
        },
      },
    });

    return res.status(201).json({ success: true, message: 'PQRS creada exitosamente', pqrs: createdPqrs });
  } catch (error: any) {
    console.error('[createPqrs Error]:', error);
    return res.status(500).json({ success: false, message: `Error al crear PQRS: ${error.message}`, error: error.message });
  }
};

/**
 * GET /api/pqrs/:id
 * Detalle completo de PQRS con historial de mensajes
 */
export const getPqrsDetail = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const pqrs = await prisma.pqrs.findUnique({
      where: { id },
      include: {
        resident: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            pushToken: true,
            property: {
              select: {
                unitNumber: true,
                block: true,
              },
            },
          },
        },
        house: {
          select: {
            id: true,
            unitNumber: true,
            block: true,
          },
        },
        assignedToUser: {
          select: {
            id: true,
            fullName: true,
            role: true,
            email: true,
          },
        },
        messages: {
          include: {
            sender: {
              select: { id: true, fullName: true, avatarUrl: true, role: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!pqrs) return res.status(404).json({ success: false, message: 'PQRS no encontrada.' });

    return res.json({ success: true, pqrs });
  } catch (error: any) {
    console.error('[getPqrsDetail Error]:', error);
    return res.status(500).json({ success: false, message: 'Error al obtener el detalle de la PQRS', error: error.message });
  }
};

/**
 * POST /api/pqrs/:id/messages
 * Enviar mensaje / respuesta en hilo de conversación de PQRS
 */
export const sendPqrsMessage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { message } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });
    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });
    }

    const pqrs = await prisma.pqrs.findUnique({
      where: { id },
      include: {
        resident: {
          select: { id: true, fullName: true, email: true, pushToken: true },
        },
      },
    });

    if (!pqrs) return res.status(404).json({ success: false, message: 'PQRS no encontrada.' });

    let sender = await prisma.user.findUnique({ where: { id: userId } });
    if (!sender && req.user?.email) {
      sender = await prisma.user.findUnique({ where: { email: req.user.email } });
    }
    if (!sender) {
      sender = await prisma.user.findFirst({ where: { role: 'RESIDENTIAL_ADMIN' } }) || await prisma.user.findFirst();
    }

    if (!sender) {
      return res.status(400).json({ success: false, message: 'Usuario no encontrado.' });
    }

    const isStaff = sender.role === 'ADMIN' || sender.role === 'RESIDENTIAL_ADMIN' || sender.role === 'GUARD';

    const newMessage = await prisma.pqrsMessage.create({
      data: {
        pqrsId: id,
        senderId: sender.id,
        message: message.trim(),
        isStaff,
      },
      include: {
        sender: {
          select: { id: true, fullName: true, avatarUrl: true, role: true },
        },
      },
    });

    // Si el staff responde y el estado era OPEN, avanzar a IN_PROGRESS
    if (isStaff && pqrs.status === 'OPEN') {
      await prisma.pqrs.update({
        where: { id },
        data: { status: 'IN_PROGRESS' },
      });
    }

    // Notificar al residente vía Push si el staff respondió
    let targetPushToken: string | null = pqrs.resident?.pushToken || null;
    if (!targetPushToken) {
      const residentUser = await prisma.user.findFirst({
        where: {
          OR: [{ id: pqrs.residentId }, { email: pqrs.resident?.email }],
          pushToken: { not: null },
        },
      });
      targetPushToken = residentUser?.pushToken || null;
    }

    if (isStaff && targetPushToken) {
      sendPushNotification(
        targetPushToken,
        `💬 Respuesta a tu PQRS: ${pqrs.subject}`,
        `Administración: ${message.trim().substring(0, 120)}${message.length > 120 ? '...' : ''}`,
        { type: 'PQRS_MESSAGE_CREATED', pqrsId: id }
      );
    }

    return res.status(201).json({ success: true, message: newMessage });
  } catch (error: any) {
    console.error('[sendPqrsMessage Error]:', error);
    return res.status(500).json({ success: false, message: `Error al enviar mensaje: ${error.message}`, error: error.message });
  }
};

/**
 * PATCH /api/pqrs/:id/status
 * Actualizar estado del ticket PQRS
 */
export const updatePqrsStatus = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { id } = req.params;
    const { status } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });
    if (!status) return res.status(400).json({ success: false, message: 'Estado requerido.' });

    const pqrs = await prisma.pqrs.findUnique({
      where: { id },
      include: {
        resident: { select: { id: true, fullName: true, email: true, pushToken: true } },
      },
    });

    if (!pqrs) return res.status(404).json({ success: false, message: 'PQRS no encontrada.' });

    const updatedPqrs = await prisma.pqrs.update({
      where: { id },
      data: { status },
      include: {
        resident: {
          select: {
            id: true,
            fullName: true,
            email: true,
            property: { select: { unitNumber: true, block: true } },
          },
        },
        house: { select: { unitNumber: true, block: true } },
        messages: {
          include: {
            sender: { select: { id: true, fullName: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    let targetPushToken: string | null = pqrs.resident?.pushToken || null;
    if (!targetPushToken) {
      const residentUser = await prisma.user.findFirst({
        where: {
          OR: [{ id: pqrs.residentId }, { email: pqrs.resident?.email }],
          pushToken: { not: null },
        },
      });
      targetPushToken = residentUser?.pushToken || null;
    }

    if (targetPushToken) {
      const statusTitle =
        status === 'RESOLVED'
          ? '✅ PQRS Resuelta'
          : status === 'IN_PROGRESS'
          ? '⚙️ PQRS En Proceso'
          : status === 'CLOSED'
          ? '📁 PQRS Cerrada'
          : `📬 PQRS Actualizada`;

      const bodyText = `Tu solicitud "${pqrs.subject}" ha sido actualizada a estado ${status} por la administración.`;

      sendPushNotification(targetPushToken, statusTitle, bodyText, {
        type: 'PQRS_STATUS_UPDATED',
        pqrsId: id,
        status,
      });
    }

    return res.json({
      success: true,
      message: `Estado de PQRS actualizado a ${status}`,
      pqrs: updatedPqrs,
    });
  } catch (error: any) {
    console.error('[updatePqrsStatus Error]:', error);
    return res.status(500).json({ success: false, message: 'Error al actualizar estado de PQRS', error: error.message });
  }
};

/**
 * PATCH /api/pqrs/:id/assign
 * Asignar personal de mantenimiento/administración a una PQRS (Fase 3 Spec)
 */
export const assignPqrsStaff = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { assignedToUserId } = req.body;

    const pqrs = await prisma.pqrs.findUnique({ where: { id } });
    if (!pqrs) return res.status(404).json({ success: false, message: 'PQRS no encontrada.' });

    let staff = null;
    if (assignedToUserId) {
      staff = await prisma.user.findUnique({
        where: { id: assignedToUserId },
        select: { id: true, fullName: true, email: true },
      });
      if (!staff) {
        return res.status(404).json({ success: false, message: 'Usuario asignado no encontrado.' });
      }
    }

    const updated = await prisma.pqrs.update({
      where: { id },
      data: {
        assignedToUserId: assignedToUserId || null,
        ...(pqrs.status === 'OPEN' ? { status: 'IN_PROGRESS' } : {}),
      },
      include: {
        assignedToUser: { select: { id: true, fullName: true, role: true } },
        resident: { select: { fullName: true } },
      },
    });

    return res.json({
      success: true,
      message: staff ? `PQRS asignada a ${staff.fullName}` : 'Asignación removida',
      pqrs: updated,
    });
  } catch (error: any) {
    console.error('[assignPqrsStaff Error]:', error);
    return res.status(500).json({ success: false, message: 'Error al asignar staff a PQRS', error: error.message });
  }
};
