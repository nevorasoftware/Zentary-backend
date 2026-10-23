import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { logAuditEvent } from '../services/audit.service.js';
import { getHoldMinutes, getStatus, releaseExpired } from '../services/parking.service.js';

const requireTenantId = (req: AuthRequest, res: Response): string | null => {
  const tenantId = req.tenantId;
  if (!tenantId) {
    res.status(400).json({ success: false, code: 'TENANT_REQUIRED', message: 'Selecciona una residencial.' });
    return null;
  }
  return tenantId;
};

const parseCapacity = (value: any): number | null => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 500 ? n : null;
};

// GET /parking/zones
export const listZones = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const [zones, holdMinutes] = await Promise.all([
      prisma.visitorParkingZone.findMany({
        where: { tenantId },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
      getHoldMinutes(tenantId),
    ]);
    return res.json({ success: true, zones, holdMinutes });
  } catch (error: any) {
    console.error('listZones:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// GET /parking/status
export const getParkingStatus = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const status = await getStatus(tenantId);
    return res.json({ success: true, ...status });
  } catch (error: any) {
    console.error('getParkingStatus:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// POST /parking/zones
export const createZone = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const capacity = parseCapacity(req.body.capacity);
    if (!name || name.length > 60) {
      return res.status(400).json({ success: false, message: 'Nombre de zona requerido (máximo 60 caracteres).' });
    }
    if (capacity === null) {
      return res.status(400).json({ success: false, message: 'La capacidad debe ser un entero entre 1 y 500.' });
    }
    const sortOrder = Number.isInteger(Number(req.body.sortOrder)) ? Number(req.body.sortOrder) : 0;

    const zone = await prisma.visitorParkingZone.create({
      data: { tenantId, name, capacity, sortOrder, isActive: req.body.isActive === false ? false : true },
    });

    await logAuditEvent({
      tenantId,
      userId: req.user?.id,
      action: 'PARKING_ZONE_CREATE',
      entity: 'VisitorParkingZone',
      entityId: zone.id,
      details: `Zona de parqueo creada: ${name} (capacidad ${capacity})`,
    });
    return res.status(201).json({ success: true, zone });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Ya existe una zona con ese nombre.' });
    }
    console.error('createZone:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// PUT /parking/zones/:id
export const updateZone = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const zone = await prisma.visitorParkingZone.findFirst({ where: { id: req.params.id, tenantId } });
    if (!zone) return res.status(404).json({ success: false, message: 'Zona no encontrada.' });

    const data: any = {};
    if (req.body.name !== undefined) {
      const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
      if (!name || name.length > 60) {
        return res.status(400).json({ success: false, message: 'Nombre de zona requerido (máximo 60 caracteres).' });
      }
      data.name = name;
    }
    if (req.body.capacity !== undefined) {
      const capacity = parseCapacity(req.body.capacity);
      if (capacity === null) {
        return res.status(400).json({ success: false, message: 'La capacidad debe ser un entero entre 1 y 500.' });
      }
      data.capacity = capacity;
    }
    if (typeof req.body.isActive === 'boolean') data.isActive = req.body.isActive;
    if (req.body.sortOrder !== undefined && Number.isInteger(Number(req.body.sortOrder))) {
      data.sortOrder = Number(req.body.sortOrder);
    }

    // El chequeo de capacidad y la actualización van bajo el mismo bloqueo de zona que usa la reserva
    const result = await prisma.$transaction(async (tx) => {
      if (data.capacity !== undefined && data.capacity < zone.capacity) {
        await releaseExpired(tenantId, tx);
        await tx.$queryRaw`SELECT id FROM "VisitorParkingZone" WHERE id = ${zone.id} FOR UPDATE`;
        const active = await tx.visitorParkingReservation.count({
          where: { tenantId, zoneId: zone.id, status: { in: ['RESERVADO', 'OCUPADO'] } },
        });
        if (data.capacity < active) return { conflict: active };
      }
      return { zone: await tx.visitorParkingZone.update({ where: { id: zone.id }, data }) };
    });
    if ('conflict' in result) {
      return res.status(409).json({
        success: false,
        message: `No se puede reducir la capacidad por debajo de los parqueos en uso (${result.conflict}).`,
      });
    }
    return res.json({ success: true, zone: result.zone });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'Ya existe una zona con ese nombre.' });
    }
    console.error('updateZone:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// DELETE /parking/zones/:id (con reservas registradas se desactiva en lugar de borrar)
export const deleteZone = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const zone = await prisma.visitorParkingZone.findFirst({ where: { id: req.params.id, tenantId } });
    if (!zone) return res.status(404).json({ success: false, message: 'Zona no encontrada.' });

    await releaseExpired(tenantId);
    const used = await prisma.visitorParkingReservation.count({ where: { zoneId: zone.id, tenantId } });
    if (used > 0) {
      const updated = await prisma.visitorParkingZone.update({ where: { id: zone.id }, data: { isActive: false } });
      return res.json({ success: true, deactivated: true, zone: updated, message: 'La zona tiene reservas y se desactivó.' });
    }
    await prisma.visitorParkingZone.delete({ where: { id: zone.id } });
    return res.json({ success: true, deleted: true });
  } catch (error: any) {
    console.error('deleteZone:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// PUT /parking/config
export const updateConfig = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = requireTenantId(req, res);
    if (!tenantId) return;
    const holdMinutes = Number(req.body.holdMinutes);
    if (!Number.isInteger(holdMinutes) || holdMinutes < 5 || holdMinutes > 720) {
      return res.status(400).json({ success: false, message: 'Los minutos de espera deben ser un entero entre 5 y 720.' });
    }
    const config = await prisma.visitorParkingConfig.upsert({
      where: { tenantId },
      create: { tenantId, holdMinutes },
      update: { holdMinutes },
    });
    return res.json({ success: true, holdMinutes: config.holdMinutes });
  } catch (error: any) {
    console.error('updateConfig:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};
