import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { logAuditEvent } from '../services/audit.service.js';

// List house prefixes for current tenant
export const listHousePrefixes = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID requerido.' });
    }

    const prefixes = await prisma.housePrefix.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });

    return res.json({ success: true, prefixes });
  } catch (error: any) {
    console.error('listHousePrefixes:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// Create a house prefix
export const createHousePrefix = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID requerido.' });
    }

    const { code, label, houseType, isActive, sortOrder } = req.body;
    if (!code || typeof code !== 'string' || code.trim() === '' || code.length > 20) {
      return res.status(400).json({ success: false, message: 'El prefijo es obligatorio (máximo 20 caracteres).' });
    }

    const prefix = await prisma.housePrefix.create({
      data: {
        tenantId,
        code,
        label: label || null,
        houseType: houseType || 'CASA',
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        ...(Number.isInteger(sortOrder) && { sortOrder }),
      },
    });

    await logAuditEvent({
      tenantId,
      userId: req.user?.id,
      action: 'CREATE_HOUSE_PREFIX',
      entity: 'HousePrefix',
      entityId: prefix.id,
      details: { code },
      ipAddress: req.ip,
    });

    return res.status(201).json({ success: true, message: 'Prefijo creado exitosamente.', prefix });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Ya existe un prefijo con ese código.' });
    }
    console.error('createHousePrefix:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// Update a house prefix
export const updateHousePrefix = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID requerido.' });
    }

    const { code, label, houseType, isActive, sortOrder } = req.body;
    if (code !== undefined && (typeof code !== 'string' || code.trim() === '' || code.length > 20)) {
      return res.status(400).json({ success: false, message: 'El prefijo es obligatorio (máximo 20 caracteres).' });
    }

    const updated = await prisma.housePrefix.updateMany({
      where: { id, tenantId },
      data: {
        ...(code !== undefined && { code }),
        ...(label !== undefined && { label: label || null }),
        ...(houseType && { houseType }),
        ...(isActive !== undefined && { isActive: Boolean(isActive) }),
        ...(Number.isInteger(sortOrder) && { sortOrder }),
      },
    });

    if (updated.count === 0) {
      return res.status(404).json({ success: false, message: 'Prefijo no encontrado.' });
    }

    await logAuditEvent({
      tenantId,
      userId: req.user?.id,
      action: 'UPDATE_HOUSE_PREFIX',
      entity: 'HousePrefix',
      entityId: id,
      details: req.body,
      ipAddress: req.ip,
    });

    return res.json({ success: true, message: 'Prefijo actualizado correctamente.' });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Ya existe un prefijo con ese código.' });
    }
    console.error('updateHousePrefix:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// Delete a house prefix (si tiene viviendas ligadas, solo se desactiva)
export const deleteHousePrefix = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID requerido.' });
    }

    const prefix = await prisma.housePrefix.findFirst({ where: { id, tenantId } });
    if (!prefix) {
      return res.status(404).json({ success: false, message: 'Prefijo no encontrado.' });
    }

    const linkedHouses = await prisma.house.count({ where: { prefixId: id, tenantId } });
    if (linkedHouses > 0) {
      await prisma.housePrefix.update({ where: { id }, data: { isActive: false } });
    } else {
      await prisma.housePrefix.delete({ where: { id } });
    }

    await logAuditEvent({
      tenantId,
      userId: req.user?.id,
      action: 'DELETE_HOUSE_PREFIX',
      entity: 'HousePrefix',
      entityId: id,
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      deactivated: linkedHouses > 0,
      message: linkedHouses > 0
        ? 'El prefijo tiene viviendas asociadas; se desactivó.'
        : 'Prefijo eliminado correctamente.',
    });
  } catch (error: any) {
    console.error('deleteHousePrefix:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};
