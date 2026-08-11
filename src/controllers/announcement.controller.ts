import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';

export const getAnnouncements = async (_req: AuthRequest, res: Response) => {
  try {
    const announcements = await prisma.announcement.findMany({
      include: {
        author: {
          select: { id: true, fullName: true, avatarUrl: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, announcements });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener anuncios', error: error.message });
  }
};

export const createAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { title, body, category } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });
    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Título y contenido requeridos.' });
    }

    const announcement = await prisma.announcement.create({
      data: {
        title,
        body,
        category: category || 'GENERAL',
        authorId: userId,
      },
      include: {
        author: { select: { id: true, fullName: true } },
      },
    });

    return res.status(201).json({
      success: true,
      message: 'Anuncio publicado exitosamente',
      announcement,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al publicar anuncio', error: error.message });
  }
};

export const deleteAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.announcement.delete({ where: { id } });

    return res.json({ success: true, message: 'Anuncio eliminado correctamente' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al eliminar anuncio', error: error.message });
  }
};
