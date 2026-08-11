import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';

export const getUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { role, search } = req.query;

    const where: any = {};
    if (role) where.role = role as string;
    if (search) {
      where.OR = [
        { fullName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      include: { property: true },
      orderBy: { createdAt: 'desc' },
    });

    const sanitizedUsers = users.map(({ password, ...u }) => u);
    return res.json({ success: true, users: sanitizedUsers });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener usuarios', error: error.message });
  }
};

export const toggleUserAccess = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isActive: Boolean(isActive) },
      include: { property: true },
    });

    const { password, ...sanitizedUser } = user;
    return res.json({
      success: true,
      message: `Acceso del usuario ${isActive ? 'activado' : 'desactivado'} con éxito.`,
      user: sanitizedUser,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar acceso de usuario', error: error.message });
  }
};

export const getDashboardStats = async (_req: AuthRequest, res: Response) => {
  try {
    const totalResidents = await prisma.user.count({ where: { role: 'RESIDENT' } });
    const activeVisits = await prisma.visit.count({ where: { category: 'EN_CURSO', status: 'IN_PROGRESS' } });
    const pendingParcels = await prisma.parcel.count({ where: { status: 'PENDING' } });
    const openPqrs = await prisma.pqrs.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } });
    const totalPendingPayments = await prisma.payment.aggregate({
      where: { status: 'PENDING' },
      _sum: { amount: true },
    });

    return res.json({
      success: true,
      stats: {
        totalResidents,
        activeVisits,
        pendingParcels,
        openPqrs,
        pendingPaymentsSum: totalPendingPayments._sum.amount || 0,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener estadísticas', error: error.message });
  }
};
