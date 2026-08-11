import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';

export const getParcels = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const parcels = await prisma.parcel.findMany({
      where: { residentId: userId },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, parcels });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener paquetes', error: error.message });
  }
};

export const createParcel = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { carrier, customCarrier, trackingNumber, photoUrl, notes } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });
    if (!carrier) return res.status(400).json({ success: false, message: 'La paquetería / carrier es requerida.' });

    const parcel = await prisma.parcel.create({
      data: {
        residentId: userId,
        carrier,
        customCarrier: customCarrier || null,
        trackingNumber: trackingNumber || null,
        photoUrl: photoUrl || null,
        notes: notes || null,
      },
    });

    return res.status(201).json({ success: true, message: 'Registro de paquete guardado exitosamente', parcel });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al registrar paquete', error: error.message });
  }
};

export const markParcelPickedUp = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const parcel = await prisma.parcel.update({
      where: { id },
      data: {
        status: 'PICKED_UP',
        pickedUpAt: new Date(),
      },
    });

    return res.json({ success: true, message: 'Paquete marcado como entregado/retirado', parcel });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar el estado del paquete', error: error.message });
  }
};
