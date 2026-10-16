import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { logAuditEvent } from '../services/audit.service.js';

// List vehicles
export const listVehicles = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    const isResident = req.user?.role === 'RESIDENT';

    const vehicles = await prisma.vehicle.findMany({
      where: {
        ...(tenantId ? { tenantId } : {}),
        ...(isResident && req.user?.id ? { residentId: req.user.id } : {}),
      },
      include: {
        house: {
          select: {
            id: true,
            unitNumber: true,
            block: true,
          },
        },
        resident: {
          select: {
            id: true,
            fullName: true,
            phone: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, vehicles });
  } catch (error: any) {
    console.error('listVehicles:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// Register a vehicle
export const createVehicle = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID requerido.' });
    }

    const { houseId, residentId, brand, model, color, plate, type, photoUrl } = req.body;

    if (!brand || !model || !color || !plate) {
      return res.status(400).json({
        success: false,
        message: 'Marca, modelo, color y placa son campos requeridos.',
      });
    }

    const cleanPlate = plate.toUpperCase().trim();

    // Un residente siempre registra a su nombre; los demás roles pueden indicar un residente de su tenant
    let targetResidentId: string | null = null;
    if (req.user?.role === 'RESIDENT') {
      targetResidentId = req.user.id;
    } else if (residentId) {
      const resident = await prisma.user.findFirst({
        where: { id: String(residentId), tenantId },
        select: { id: true },
      });
      if (!resident) {
        return res.status(404).json({ success: false, message: 'Residente no encontrado.' });
      }
      targetResidentId = resident.id;
    }

    if (houseId) {
      const house = await prisma.house.findFirst({
        where: { id: String(houseId), tenantId },
        select: { id: true },
      });
      if (!house) {
        return res.status(404).json({ success: false, message: 'Unidad no encontrada.' });
      }
    }

    const vehicle = await prisma.vehicle.create({
      data: {
        tenantId,
        houseId: houseId || null,
        residentId: targetResidentId,
        brand,
        model,
        color,
        plate: cleanPlate,
        type: type || 'SEDAN',
        photoUrl: photoUrl || null,
        isActive: true,
      },
      include: {
        house: true,
        resident: { select: { id: true, fullName: true, email: true, phone: true } },
      },
    });

    await logAuditEvent({
      tenantId,
      userId: req.user?.id,
      action: 'REGISTER_VEHICLE',
      entity: 'Vehicle',
      entityId: vehicle.id,
      details: { plate: cleanPlate, brand, model },
      ipAddress: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: 'Vehículo registrado exitosamente.',
      vehicle,
    });
  } catch (error: any) {
    console.error('createVehicle:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// Update vehicle
export const updateVehicle = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const { brand, model, color, plate, type, photoUrl, isActive } = req.body;

    const updated = await prisma.vehicle.updateMany({
      where: {
        id,
        ...(tenantId ? { tenantId } : {}),
        ...(req.user?.role === 'RESIDENT' ? { residentId: req.user.id } : {}),
      },
      data: {
        ...(brand && { brand }),
        ...(model && { model }),
        ...(color && { color }),
        ...(plate && { plate: plate.toUpperCase().trim() }),
        ...(type && { type }),
        ...(photoUrl !== undefined && { photoUrl }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    if (updated.count === 0) {
      return res.status(404).json({ success: false, message: 'Vehículo no encontrado.' });
    }

    return res.json({ success: true, message: 'Vehículo actualizado exitosamente.' });
  } catch (error: any) {
    console.error('updateVehicle:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// Delete/Deactivate vehicle
export const deleteVehicle = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;

    const deleted = await prisma.vehicle.deleteMany({
      where: {
        id,
        ...(tenantId ? { tenantId } : {}),
        ...(req.user?.role === 'RESIDENT' ? { residentId: req.user.id } : {}),
      },
    });

    if (deleted.count === 0) {
      return res.status(404).json({ success: false, message: 'Vehículo no encontrado.' });
    }

    return res.json({ success: true, message: 'Vehículo eliminado exitosamente.' });
  } catch (error: any) {
    console.error('deleteVehicle:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};
