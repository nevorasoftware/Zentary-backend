import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { logAuditEvent } from '../services/audit.service.js';

// List houses for current tenant
export const listHouses = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID requerido.' });
    }

    const houses = await prisma.house.findMany({
      where: { tenantId },
      include: {
        residents: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            role: true,
            isActive: true,
          },
        },
        vehicles: {
          select: {
            id: true,
            brand: true,
            model: true,
            plate: true,
            color: true,
          },
        },
      },
      orderBy: [{ block: 'asc' }, { unitNumber: 'asc' }],
    });

    return res.json({ success: true, houses });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get house details by ID
export const getHouseById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const house = await prisma.house.findFirst({
      where: {
        id,
        ...(tenantId ? { tenantId } : {}),
      },
      include: {
        residents: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
            role: true,
            isActive: true,
          },
        },
        vehicles: true,
      },
    });

    if (!house) {
      return res.status(404).json({ success: false, message: 'Vivienda no encontrada.' });
    }

    return res.json({ success: true, house });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Create a new house in tenant
export const createHouse = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID requerido.' });
    }

    const { unitNumber, block, type, status, ownerName, ownerPhone, ownerEmail, notes } = req.body;

    if (!unitNumber) {
      return res.status(400).json({ success: false, message: 'El número de vivienda es obligatorio.' });
    }

    const house = await prisma.house.create({
      data: {
        tenantId,
        unitNumber,
        block: block || null,
        type: type || 'CASA',
        status: status || 'HABITADA',
        ownerName: ownerName || null,
        ownerPhone: ownerPhone || null,
        ownerEmail: ownerEmail || null,
        financialStatus: 'SOLVENTE',
        notes: notes || null,
      },
    });

    await logAuditEvent({
      tenantId,
      userId: req.user?.id,
      action: 'CREATE_HOUSE',
      entity: 'House',
      entityId: house.id,
      details: { unitNumber, block },
      ipAddress: req.ip,
    });

    return res.status(201).json({ success: true, message: 'Vivienda registrada exitosamente.', house });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Update house details
export const updateHouse = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const { unitNumber, block, type, status, ownerName, ownerPhone, ownerEmail, financialStatus, notes } = req.body;

    const updated = await prisma.house.updateMany({
      where: {
        id,
        ...(tenantId ? { tenantId } : {}),
      },
      data: {
        ...(unitNumber && { unitNumber }),
        ...(block !== undefined && { block }),
        ...(type && { type }),
        ...(status && { status }),
        ...(ownerName !== undefined && { ownerName }),
        ...(ownerPhone !== undefined && { ownerPhone }),
        ...(ownerEmail !== undefined && { ownerEmail }),
        ...(financialStatus && { financialStatus }),
        ...(notes !== undefined && { notes }),
      },
    });

    if (updated.count === 0) {
      return res.status(404).json({ success: false, message: 'Vivienda no encontrada.' });
    }

    await logAuditEvent({
      tenantId: tenantId || 'global',
      userId: req.user?.id,
      action: 'UPDATE_HOUSE',
      entity: 'House',
      entityId: id,
      details: req.body,
      ipAddress: req.ip,
    });

    return res.json({ success: true, message: 'Vivienda actualizada correctamente.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Delete a house
export const deleteHouse = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const deleted = await prisma.house.deleteMany({
      where: {
        id,
        ...(tenantId ? { tenantId } : {}),
      },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ success: false, message: 'Vivienda no encontrada.' });
    }

    await logAuditEvent({
      tenantId: tenantId || 'global',
      userId: req.user?.id,
      action: 'DELETE_HOUSE',
      entity: 'House',
      entityId: id,
      ipAddress: req.ip,
    });

    return res.json({ success: true, message: 'Vivienda eliminada correctamente.' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
