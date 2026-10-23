import { NextFunction, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { logAuditEvent } from '../services/audit.service.js';
import {
  generateInitialPassword,
  normalizeBlock,
  normalizeUnit,
  resolveCommunityForTenant,
} from './admin.controller.js';
import { parseCsv, toCsv, unescapeFormula } from '../utils/csv.js';

const MAX_ROWS = 500;
const MAX_REPORT_CHARS = 64 * 1024;
const HOUSE_NUMBER_REGEX = /^[A-Za-z0-9]{1,10}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HEADER = ['codigo', 'bloque', 'tipo', 'estado', 'nombre', 'telefono', 'correo'];

const stripAccents = (v: string) => v.normalize('NFD').replace(/[̀-ͯ]/g, '');
const normalizeHeader = (h: string) => stripAccents(h).trim().toLowerCase();
const clean = (v: string | undefined) => unescapeFormula((v ?? '').trim());
const upperCode = (v: string) => stripAccents(v).trim().toUpperCase().replace(/\s+/g, '_');

interface ReportRow {
  fila: number;
  codigo: string;
  vivienda: 'creada' | 'actualizada' | 'sin_cambios' | 'error';
  usuario: 'creado' | 'actualizado' | 'sin_cambios' | 'ninguno' | 'error';
  mensaje: string;
  usuarioId?: string;
  correo?: string;
  nombre?: string;
}

interface Ctx {
  tenantId: string;
  communityId: string;
  dryRun: boolean;
  prefixes: { id: string; code: string; houseType: string }[];
  simHouses: Set<string>;
  simEmails: Set<string>;
}

interface Parsed {
  unit: string;
  block: string | null;
  tipo: string;
  estado: string;
  nombre: string;
  telefono: string;
  correo: string;
}

// Handler JSON para el 413 de body-parser (solo en la ruta de importación)
export const importBodyErrorHandler = (err: any, _req: AuthRequest, res: Response, next: NextFunction) => {
  if (err?.type === 'entity.too.large' || err?.status === 413) {
    return res.status(413).json({ success: false, message: 'El archivo supera el máximo de 2 MB.' });
  }
  if (err?.status === 400 || err?.statusCode === 400) {
    return res.status(400).json({ success: false, message: 'No se pudo leer el archivo.' });
  }
  return next(err);
};

// GET /houses/export
export const exportHouses = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID requerido.' });
    }

    const houses = await prisma.house.findMany({
      where: { tenantId },
      include: {
        residents: {
          where: { role: 'RESIDENT' },
          select: { fullName: true, phone: true, email: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ block: 'asc' }, { unitNumber: 'asc' }],
    });

    // Una fila por residente; las viviendas sin residentes salen con los datos de persona vacíos
    const rows: unknown[][] = [HEADER];
    for (const h of houses) {
      if (h.residents.length === 0) {
        rows.push([h.unitNumber, h.block, h.type, h.status, '', '', '']);
      } else {
        for (const r of h.residents) {
          rows.push([h.unitNumber, h.block, h.type, h.status, r.fullName, r.phone, r.email]);
        }
      }
    }

    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="viviendas-${stamp}.csv"`);
    return res.send('﻿' + toCsv(rows));
  } catch (error: any) {
    console.error('exportHouses:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// Cambios a aplicar sobre una vivienda existente: tipo/estado si vienen y difieren;
// datos del propietario solo si la vivienda aún no los tiene.
const houseChanges = (house: any, p: Parsed) => {
  const data: Record<string, string> = {};
  // Se compara normalizado para que diferencias solo de mayúsculas o acentos no cuenten como cambio
  if (p.tipo && p.tipo !== upperCode(house.type)) data.type = p.tipo;
  if (p.estado && p.estado !== upperCode(house.status)) data.status = p.estado;
  if (!house.ownerName && !house.ownerPhone && !house.ownerEmail) {
    if (p.nombre) data.ownerName = p.nombre;
    if (p.telefono) data.ownerPhone = p.telefono;
    if (p.correo) data.ownerEmail = p.correo;
  }
  return data;
};

const fail = (entry: ReportRow, message: string) => {
  entry.vivienda = 'error';
  entry.usuario = 'error';
  entry.mensaje = message;
};

const processRow = async (ctx: Ctx, entry: ReportRow, p: Parsed) => {
  const { tenantId, communityId, dryRun } = ctx;

  if (!p.unit) return fail(entry, 'El código de vivienda es obligatorio.');
  if (p.unit.length > 50 || (p.block && p.block.length > 50)) return fail(entry, 'Código o bloque demasiado largo.');
  if (p.correo && !EMAIL_REGEX.test(p.correo)) return fail(entry, 'El correo no es válido.');

  const houseWhere = {
    tenantId,
    unitNumber: { equals: p.unit, mode: 'insensitive' as const },
    block: p.block === null ? null : { equals: p.block, mode: 'insensitive' as const },
  };
  const simKey = `${p.unit.toLowerCase()}|${(p.block ?? '').toLowerCase()}`;
  const simulated = dryRun && ctx.simHouses.has(simKey);
  const existingHouse = simulated ? null : await prisma.house.findFirst({ where: houseWhere });

  // Prefijo: solo se exige al crear una vivienda y si la residencial tiene prefijos activos
  // (las viviendas existentes, con o sin prefijo, se actualizan sin exigirlo)
  const prefix = ctx.prefixes
    .filter((x) => p.unit.startsWith(x.code) && HOUSE_NUMBER_REGEX.test(p.unit.slice(x.code.length)))
    .sort((a, b) => b.code.length - a.code.length)[0];
  if (!existingHouse && !simulated && ctx.prefixes.length > 0 && !prefix) {
    return fail(entry, 'El código no coincide con un prefijo activo de la residencial.');
  }

  // Validación del usuario antes de escribir nada: un correo de otra residencial nunca se reasigna
  let existingUser: any = null;
  if (p.correo) {
    existingUser = await prisma.user.findFirst({ where: { email: { equals: p.correo, mode: 'insensitive' } } });
    if (existingUser && existingUser.tenantId !== tenantId) {
      return fail(entry, 'El correo ya está registrado y no puede usarse en esta residencial.');
    }
    if (existingUser && existingUser.role !== 'RESIDENT') {
      return fail(entry, 'El correo pertenece a un usuario que no es residente.');
    }
    if (!existingUser && !p.nombre && !ctx.simEmails.has(p.correo)) {
      return fail(entry, 'El nombre es obligatorio para crear un residente nuevo.');
    }
  }

  if (dryRun) {
    const house = existingHouse;
    if (house) {
      entry.vivienda = Object.keys(houseChanges(house, p)).length ? 'actualizada' : 'sin_cambios';
    } else if (simulated) {
      entry.vivienda = 'sin_cambios';
    } else {
      entry.vivienda = 'creada';
      ctx.simHouses.add(simKey);
    }
    if (p.correo) {
      entry.correo = p.correo;
      entry.nombre = p.nombre || existingUser?.fullName;
      if (existingUser) {
        entry.usuarioId = existingUser.id;
        const needsUpdate =
          (p.nombre && p.nombre !== existingUser.fullName) ||
          (p.telefono && p.telefono !== (existingUser.phone ?? '')) ||
          existingUser.houseId !== house?.id;
        entry.usuario = needsUpdate ? 'actualizado' : 'sin_cambios';
      } else if (ctx.simEmails.has(p.correo)) {
        entry.usuario = 'sin_cambios';
      } else {
        entry.usuario = 'creado';
        ctx.simEmails.add(p.correo);
      }
    }
    return;
  }

  // Escritura: una transacción corta por fila. La contraseña inicial se genera y se descarta:
  // nunca se envía nada desde aquí; las credenciales se envían una a una con el reenvío existente.
  const hashed = p.correo && !existingUser ? await bcrypt.hash(generateInitialPassword(), 10) : null;
  await prisma.$transaction(async (tx) => {
    let house = await tx.house.findFirst({ where: houseWhere });
    if (!house) {
      house = await tx.house.create({
        data: {
          tenantId,
          unitNumber: p.unit,
          block: p.block,
          prefixId: prefix?.id ?? null,
          type: p.tipo || prefix?.houseType || 'CASA',
          status: p.estado || 'HABITADA',
          ownerName: p.nombre || null,
          ownerPhone: p.telefono || null,
          ownerEmail: p.correo || null,
        },
      });
      entry.vivienda = 'creada';
    } else {
      const changed = houseChanges(house, p);
      if (Object.keys(changed).length) {
        house = await tx.house.update({ where: { id: house.id }, data: changed });
        entry.vivienda = 'actualizada';
      }
    }

    if (!p.correo) return;
    entry.correo = p.correo;

    // Los 4 enlaces del residente: tenantId, communityId, propertyId y houseId
    let property = await tx.property.findFirst({
      where: { unitNumber: house.unitNumber, block: house.block, communityId },
    });
    if (!property) {
      property = await tx.property.create({
        data: { unitNumber: house.unitNumber, block: house.block, communityId },
      });
    }

    if (!existingUser) {
      const created = await tx.user.create({
        data: {
          email: p.correo,
          password: hashed!,
          mustChangePassword: true,
          fullName: p.nombre,
          phone: p.telefono || null,
          role: 'RESIDENT',
          isActive: true,
          communityId,
          tenantId,
          propertyId: property.id,
          houseId: house.id,
        },
      });
      entry.usuario = 'creado';
      entry.usuarioId = created.id;
      entry.nombre = created.fullName;
      return;
    }

    const data: Record<string, string> = {};
    if (p.nombre && p.nombre !== existingUser.fullName) data.fullName = p.nombre;
    if (p.telefono && p.telefono !== (existingUser.phone ?? '')) data.phone = p.telefono;
    if (existingUser.houseId !== house.id) data.houseId = house.id;
    if (existingUser.propertyId !== property.id) data.propertyId = property.id;
    if (existingUser.communityId !== communityId) data.communityId = communityId;
    entry.usuarioId = existingUser.id;
    entry.nombre = data.fullName || existingUser.fullName;
    if (Object.keys(data).length) {
      await tx.user.update({ where: { id: existingUser.id }, data });
      entry.usuario = 'actualizado';
    } else {
      entry.usuario = 'sin_cambios';
    }
  });
};

// POST /houses/import?dryRun=1  (cuerpo: CSV como text/csv)
export const importHouses = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Tenant ID requerido.' });
    }
    if (typeof req.body !== 'string' || !req.body.trim()) {
      return res.status(400).json({ success: false, message: 'Envía el archivo CSV como texto (text/csv).' });
    }
    const dryRun = req.query.dryRun === '1' || req.query.dryRun === 'true';
    const fileName = typeof req.query.fileName === 'string' ? req.query.fileName.slice(0, 200) : null;

    let table: string[][];
    try {
      table = parseCsv(req.body);
    } catch (e: any) {
      return res.status(400).json({ success: false, message: e.message });
    }
    const header = (table[0] || []).map(normalizeHeader);
    const col = (name: string) => header.indexOf(name);
    if (col('codigo') === -1) {
      return res.status(400).json({ success: false, message: 'El archivo debe tener la columna "codigo".' });
    }
    const dataRows = table.slice(1);
    if (dataRows.length === 0) {
      return res.status(400).json({ success: false, message: 'El archivo no tiene filas de datos.' });
    }
    if (dataRows.length > MAX_ROWS) {
      return res.status(400).json({ success: false, message: `El archivo supera el máximo de ${MAX_ROWS} filas.` });
    }

    const prefixes = await prisma.housePrefix.findMany({ where: { tenantId, isActive: true } });
    // Convención: Community.id === Tenant.id. En dryRun no se crea nada.
    const communityId = tenantId;
    if (!dryRun) await resolveCommunityForTenant(tenantId);

    const ctx: Ctx = { tenantId, communityId, dryRun, prefixes, simHouses: new Set(), simEmails: new Set() };
    const report: ReportRow[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const cells = dataRows[i];
      const get = (name: string) => (col(name) === -1 ? '' : clean(cells[col(name)]));
      const fila = i + 2;
      const entry: ReportRow = { fila, codigo: get('codigo'), vivienda: 'sin_cambios', usuario: 'ninguno', mensaje: '' };
      try {
        await processRow(ctx, entry, {
          unit: normalizeUnit(get('codigo')),
          block: normalizeBlock(get('bloque')),
          tipo: upperCode(get('tipo')),
          estado: upperCode(get('estado')),
          nombre: get('nombre'),
          telefono: get('telefono'),
          correo: get('correo').toLowerCase(),
        });
      } catch (e: any) {
        console.error('importHouses fila', fila, e?.message, e?.code);
        entry.vivienda = 'error';
        entry.usuario = 'error';
        entry.mensaje = e?.code === 'P2002' ? 'Conflicto con un registro existente. Intenta de nuevo.' : 'Error al procesar la fila.';
      }
      report.push(entry);
    }

    const isError = (r: ReportRow) => r.vivienda === 'error' || r.usuario === 'error';
    const isCreated = (r: ReportRow) => !isError(r) && (r.vivienda === 'creada' || r.usuario === 'creado');
    const isUpdated = (r: ReportRow) => !isError(r) && !isCreated(r) && (r.vivienda === 'actualizada' || r.usuario === 'actualizado');
    const totals = {
      filas: report.length,
      creadas: report.filter(isCreated).length,
      actualizadas: report.filter(isUpdated).length,
      sinCambios: report.filter((r) => !isError(r) && !isCreated(r) && !isUpdated(r)).length,
      errores: report.filter(isError).length,
      viviendasCreadas: report.filter((r) => r.vivienda === 'creada').length,
      usuariosCreados: report.filter((r) => r.usuario === 'creado').length,
    };

    // El reporte guardado se recorta hasta caber en 64 KB
    const stored = [...report];
    let json = JSON.stringify(stored);
    while (json.length > MAX_REPORT_CHARS && stored.length > 0) {
      stored.length = Math.floor(stored.length * 0.9);
      json = JSON.stringify(stored);
    }
    const record = await prisma.houseImport.create({
      data: {
        tenantId,
        userId: req.user?.id,
        fileName,
        dryRun,
        rowCount: totals.filas,
        created: totals.creadas,
        updated: totals.actualizadas,
        skipped: totals.sinCambios,
        errors: totals.errores,
        report: json,
      },
    });

    if (!dryRun) {
      await logAuditEvent({
        tenantId,
        userId: req.user?.id,
        action: 'IMPORT_HOUSES',
        entity: 'HouseImport',
        entityId: record.id,
        details: totals,
        ipAddress: req.ip,
      });
    }

    return res.json({ success: true, dryRun, importId: record.id, totals, rows: report });
  } catch (error: any) {
    console.error('importHouses:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};
