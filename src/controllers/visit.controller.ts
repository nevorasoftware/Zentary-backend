import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';

export const getVisits = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { category } = req.query; // EN_CURSO, HISTORIAL, FRECUENTE

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const whereCondition: any = { residentId: userId };
    if (category) {
      whereCondition.category = category as string;
    }

    const visits = await prisma.visit.findMany({
      where: whereCondition,
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, visits });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener visitas', error: error.message });
  }
};

export const createVisit = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { visitorName, visitorDni, vehiclePlate, category, allowedDays, allowedHours, notes } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });
    if (!visitorName) return res.status(400).json({ success: false, message: 'Nombre del visitante requerido.' });

    // Generate simulated QR payload code
    const qrCode = `ZENTARY-QR-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    const visit = await prisma.visit.create({
      data: {
        residentId: userId,
        visitorName,
        visitorDni: visitorDni || null,
        vehiclePlate: vehiclePlate || null,
        category: category || 'EN_CURSO',
        allowedDays: allowedDays || null,
        allowedHours: allowedHours || null,
        notes: notes || null,
        qrCode,
        entryDate: category === 'EN_CURSO' ? new Date() : null,
      },
    });

    return res.status(201).json({ success: true, message: 'Visita registrada exitosamente', visit });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al crear la visita', error: error.message });
  }
};

export const updateVisitStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, category } = req.body;

    const updateData: any = {};
    if (status) updateData.status = status;
    if (category) updateData.category = category;

    if (status === 'COMPLETED') {
      updateData.exitDate = new Date();
    }

    const visit = await prisma.visit.update({
      where: { id },
      data: updateData,
    });

    return res.json({ success: true, message: 'Estado de la visita actualizado', visit });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar la visita', error: error.message });
  }
};
