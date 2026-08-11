import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';

export const getPqrsList = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { search } = req.query;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const whereCondition: any = { residentId: userId };
    if (search) {
      whereCondition.OR = [
        { subject: { contains: search as string, mode: 'insensitive' } },
        { description: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const pqrsList = await prisma.pqrs.findMany({
      where: whereCondition,
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: 'desc' },
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

    const pqrs = await prisma.pqrs.create({
      data: {
        residentId: userId,
        category: category || 'PETICION',
        subject,
        description,
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
    if (!message) return res.status(400).json({ success: false, message: 'El mensaje no puede estar vacío.' });

    const user = await prisma.user.findUnique({ where: { id: userId } });
    const isStaff = user?.role === 'ADMIN' || user?.role === 'GUARD';

    const newMessage = await prisma.pqrsMessage.create({
      data: {
        pqrsId: id,
        senderId: userId,
        message,
        isStaff,
      },
    });

    return res.status(201).json({ success: true, message: newMessage });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al enviar mensaje', error: error.message });
  }
};
