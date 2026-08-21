import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { sendPushNotification } from '../services/pushNotification.service.js';

export const getPqrsList = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;
    const { search, status, category } = req.query;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const whereCondition: any = {};

    // If resident, filter by residentId. If Admin or Guard, allow viewing all.
    if (userRole === 'RESIDENT') {
      whereCondition.residentId = userId;
    }

    if (status) {
      whereCondition.status = status as string;
    }

    if (category) {
      whereCondition.category = category as string;
    }

    if (search) {
      whereCondition.OR = [
        { subject: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
        { resident: { fullName: { contains: search as string, mode: 'insensitive' } } },
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

    const user = await prisma.user.findUnique({ where: { id: userId } });

    const pqrs = await prisma.pqrs.create({
      data: {
        residentId: userId,
        category: category || 'PETICION',
        subject,
        description,
        messages: {
          create: {
            senderId: userId,
            message: description,
            isStaff: user?.role === 'ADMIN' || user?.role === 'GUARD',
          },
        },
      },
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

    return res.status(201).json({ success: true, message: 'PQRS creada exitosamente', pqrs });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al crear PQRS', error: error.message });
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
          select: { id: true, fullName: true, pushToken: true },
        },
      },
    });

    if (!pqrs) return res.status(404).json({ success: false, message: 'PQRS no encontrada.' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const isStaff = user?.role === 'ADMIN' || user?.role === 'GUARD';

    const newMessage = await prisma.pqrsMessage.create({
      data: {
        pqrsId: id,
        senderId: userId,
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
    if (isStaff && pqrs.resident?.pushToken) {
      sendPushNotification(
        pqrs.resident.pushToken,
        `💬 Respuesta a tu PQRS: ${pqrs.subject}`,
        `Administración: ${message.trim().substring(0, 120)}${message.length > 120 ? '...' : ''}`,
        { type: 'PQRS', pqrsId: id }
      );
    }

    return res.status(201).json({ success: true, message: newMessage });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al enviar mensaje', error: error.message });
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
        resident: { select: { id: true, fullName: true, pushToken: true } },
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
    if (status === 'RESOLVED' || status === 'CLOSED') {
      if (pqrs.resident?.pushToken) {
        const titleText = status === 'RESOLVED' ? `✅ PQRS Resuelta` : `📁 PQRS Cerrada`;
        const bodyText = status === 'RESOLVED' 
          ? `Tu solicitud "${pqrs.subject}" ha sido marcada como RESUELTA por la administración.`
          : `Tu solicitud "${pqrs.subject}" ha sido CERRADA por la administración.`;

        sendPushNotification(pqrs.resident.pushToken, titleText, bodyText, {
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
    return res.status(500).json({ success: false, message: 'Error al actualizar estado de PQRS', error: error.message });
  }
};
