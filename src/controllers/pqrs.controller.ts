import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { sendPushNotification } from '../services/pushNotification.service.js';

export const getPqrsList = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { search, status, category, all } = req.query;

    const isAll = String(all).toLowerCase() === 'true';

    // Locate active user in database if userId exists
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

    const whereCondition: any = {};

    // If query has all=true OR user role is ADMIN/GUARD OR demo admin, fetch ALL PQRS
    const isStaffOrAdminView =
      isAll ||
      userRole === 'ADMIN' ||
      userRole === 'GUARD' ||
      user?.role === 'ADMIN' ||
      user?.role === 'GUARD' ||
      userId === 'admin-demo-1';

    if (!isStaffOrAdminView && user) {
      whereCondition.OR = [
        { residentId: user.id },
        { resident: { email: user.email } },
      ];
    }

    if (status) {
      whereCondition.status = status as string;
    }

    if (category) {
      whereCondition.category = category as string;
    }

    if (search) {
      const searchOR = [
        { subject: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
        { resident: { fullName: { contains: search as string, mode: 'insensitive' } } },
      ];

      if (whereCondition.OR) {
        whereCondition.AND = [
          { OR: whereCondition.OR },
          { OR: searchOR }
        ];
        delete whereCondition.OR;
      } else {
        whereCondition.OR = searchOR;
      }
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
            property: {
              select: {
                unitNumber: true,
                block: true,
              },
            },
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

export const createPqrs = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { category, subject, description } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });
    if (!subject || !description) {
      return res.status(400).json({ success: false, message: 'Asunto y descripción son requeridos.' });
    }

    // Locate active user in PostgreSQL
    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user && req.user?.email) {
      user = await prisma.user.findUnique({ where: { email: req.user.email } });
    }

    // Fallback: If no user found (e.g. initial demo token), get or create resident
    if (!user) {
      user = await prisma.user.findFirst({ where: { role: 'RESIDENT' } });
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

    const pqrs = await prisma.pqrs.create({
      data: {
        residentId: user.id,
        category: validCategory as any,
        subject: subject.trim(),
        description: description.trim(),
      },
    });

    await prisma.pqrsMessage.create({
      data: {
        pqrsId: pqrs.id,
        senderId: user.id,
        message: description.trim(),
        isStaff: user.role === 'ADMIN' || user.role === 'GUARD',
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
      sender = await prisma.user.findFirst({ where: { role: 'ADMIN' } }) || await prisma.user.findFirst();
    }

    if (!sender) {
      return res.status(400).json({ success: false, message: 'Usuario no encontrado.' });
    }

    const isStaff = sender.role === 'ADMIN' || sender.role === 'GUARD';

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

    // If staff responded, update PQRS status to IN_PROGRESS if OPEN
    if (isStaff && pqrs.status === 'OPEN') {
      await prisma.pqrs.update({
        where: { id },
        data: { status: 'IN_PROGRESS' },
      });
    }

    // Send push notification to resident if staff replied
    let targetPushToken: string | null = pqrs.resident?.pushToken || null;
    if (!targetPushToken) {
      const residentUser = await prisma.user.findFirst({
        where: {
          OR: [{ id: pqrs.residentId }, { email: pqrs.resident?.email }, { role: 'RESIDENT' }],
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
        { type: 'PQRS', pqrsId: id }
      );
    }

    return res.status(201).json({ success: true, message: newMessage });
  } catch (error: any) {
    console.error('[sendPqrsMessage Error]:', error);
    return res.status(500).json({ success: false, message: `Error al enviar mensaje: ${error.message}`, error: error.message });
  }
};

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
        messages: {
          include: {
            sender: { select: { id: true, fullName: true, role: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    // Send Push Notification if marked as RESOLVED or CLOSED by Admin
    let targetPushToken: string | null = pqrs.resident?.pushToken || null;
    if (!targetPushToken) {
      const residentUser = await prisma.user.findFirst({
        where: {
          OR: [{ id: pqrs.residentId }, { email: pqrs.resident?.email }, { role: 'RESIDENT' }],
          pushToken: { not: null },
        },
      });
      targetPushToken = residentUser?.pushToken || null;
    }

    if (status === 'RESOLVED' || status === 'CLOSED') {
      if (targetPushToken) {
        const titleText = status === 'RESOLVED' ? `✅ PQRS Resuelta` : `📁 PQRS Cerrada`;
        const bodyText = status === 'RESOLVED' 
          ? `Tu solicitud "${pqrs.subject}" ha sido marcada como RESUELTA por la administración.`
          : `Tu solicitud "${pqrs.subject}" ha sido CERRADA por la administración.`;

        sendPushNotification(targetPushToken, titleText, bodyText, {
          type: 'PQRS',
          pqrsId: id,
          status,
        });
      }
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
