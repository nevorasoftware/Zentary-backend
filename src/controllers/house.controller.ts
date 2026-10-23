import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { logAuditEvent } from '../services/audit.service.js';

const HOUSE_NUMBER_REGEX = /^[A-Za-z0-9]{1,10}$/;

type PrefixResolution =
  | { error: { status: number; message: string } }
  | { prefixId: string | null; unitNumber?: string; type?: string };

// Resuelve prefijo + número a unitNumber. Si la residencial tiene prefijos activos,
// exige uno al crear o cambiar la unidad; sin prefijos se conserva el texto libre.
const resolveHousePrefix = async (
  tenantId: string,
  body: { prefixId?: string | null; number?: string; unitNumber?: string },
  current?: { unitNumber: string; prefixId: string | null },
): Promise<PrefixResolution> => {
  const { prefixId, number, unitNumber } = body;

  const effectivePrefixId = prefixId || (prefixId === undefined && number !== undefined ? current?.prefixId : null) || null;
  if (effectivePrefixId) {
    if (number === undefined || number === null || !HOUSE_NUMBER_REGEX.test(String(number))) {
      return { error: { status: 400, message: 'El número debe tener de 1 a 10 caracteres alfanuméricos.' } };
    }
    const prefix = await prisma.housePrefix.findFirst({ where: { id: effectivePrefixId, tenantId } });
    if (!prefix) {
      return { error: { status: 404, message: 'Prefijo no encontrado.' } };
    }
    if (!prefix.isActive) {
      return { error: { status: 400, message: 'El prefijo está inactivo.' } };
    }
    return { prefixId: prefix.id, unitNumber: `${prefix.code}${number}`, type: prefix.houseType };
  }

  // Texto libre: solo permitido si la residencial no tiene prefijos activos
  if (unitNumber && unitNumber !== current?.unitNumber) {
    const activePrefixes = await prisma.housePrefix.count({ where: { tenantId, isActive: true } });
    if (activePrefixes > 0) {
      return { error: { status: 400, message: 'Selecciona un prefijo para la vivienda.' } };
    }
    return { prefixId: prefixId === undefined ? null : prefixId, unitNumber };
  }
  return { prefixId: prefixId === undefined ? null : prefixId };
};

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
    console.error('listHouses:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
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
    console.error('getHouseById:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// Create a new house in tenant
export const createHouse = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID requerido.' });
    }

    const { block, status, ownerName, ownerPhone, ownerEmail, notes } = req.body;
    let { unitNumber, type } = req.body;

    if (!unitNumber && !(req.body.prefixId && req.body.number)) {
      return res.status(400).json({ success: false, message: 'El número de vivienda es obligatorio.' });
    }

    const resolved = await resolveHousePrefix(tenantId, req.body);
    if ('error' in resolved) {
      return res.status(resolved.error.status).json({ success: false, message: resolved.error.message });
    }
    if (resolved.unitNumber) unitNumber = resolved.unitNumber;
    if (resolved.type) type = resolved.type;

    const house = await prisma.house.create({
      data: {
        tenantId,
        unitNumber,
        prefixId: resolved.prefixId,
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
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Ya existe una vivienda con ese número.' });
    }
    console.error('createHouse:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// Update house details
export const updateHouse = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    const { block, status, ownerName, ownerPhone, ownerEmail, financialStatus, notes } = req.body;
    let { unitNumber, type } = req.body;
    let prefixId: string | null | undefined;

    if (req.body.prefixId !== undefined || req.body.number !== undefined || unitNumber) {
      if (!tenantId) {
        return res.status(400).json({ success: false, message: 'Tenant ID requerido.' });
      }
      const current = await prisma.house.findFirst({ where: { id, tenantId } });
      if (!current) {
        return res.status(404).json({ success: false, message: 'Vivienda no encontrada.' });
      }
      const resolved = await resolveHousePrefix(tenantId, req.body, current);
      if ('error' in resolved) {
        return res.status(resolved.error.status).json({ success: false, message: resolved.error.message });
      }
      unitNumber = resolved.unitNumber;
      if (resolved.type) type = resolved.type;
      if (req.body.prefixId !== undefined || req.body.number !== undefined) prefixId = resolved.prefixId;
    }

    const updated = await prisma.house.updateMany({
      where: {
        id,
        ...(tenantId ? { tenantId } : {}),
      },
      data: {
        ...(unitNumber && { unitNumber }),
        ...(prefixId !== undefined && { prefixId }),
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
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Ya existe una vivienda con ese número.' });
    }
    console.error('updateHouse:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
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
    console.error('deleteHouse:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};
