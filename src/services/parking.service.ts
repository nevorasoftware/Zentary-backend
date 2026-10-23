import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { DEFAULT_HOLD_MINUTES, computeHoldWindow, computeZoneOccupancy } from '../utils/parking.js';

/**
 * Parqueos de visita por zonas.
 * Las funciones de hook (reserve, occupy, release, cancel) no lanzan: ante un fallo registran el error
 * (sin datos personales) y devuelven un aviso, para no tumbar la visita.
 */

type VisitLike = {
  id: string;
  validFrom: Date | null;
  vehiclePlate?: string | null;
};

export type ParkingResult = {
  parking: any | null;
  parkingWarning?: string;
};

const WARNING_FULL = 'No hay parqueos de visita disponibles en este momento. La visita se registró sin parqueo.';
const WARNING_ERROR = 'No se pudo gestionar el parqueo de la visita.';

const reservationInclude = { zone: { select: { id: true, name: true } } };

export async function getHoldMinutes(tenantId: string): Promise<number> {
  const config = await prisma.visitorParkingConfig.findUnique({ where: { tenantId } });
  return config?.holdMinutes ?? DEFAULT_HOLD_MINUTES;
}

/**
 * Expiración perezosa: RESERVADO con holdUntil vencido pasa a EXPIRADO.
 */
export async function releaseExpired(tenantId: string, client: Prisma.TransactionClient | typeof prisma = prisma) {
  return client.visitorParkingReservation.updateMany({
    where: { tenantId, status: 'RESERVADO', holdUntil: { lt: new Date() } },
    data: { status: 'EXPIRADO', releasedAt: new Date() },
  });
}

function formatReservation(r: any) {
  if (!r) return null;
  return {
    id: r.id,
    zoneId: r.zoneId,
    zoneName: r.zone?.name ?? null,
    status: r.status,
    holdFrom: r.holdFrom,
    holdUntil: r.holdUntil,
    occupiedAt: r.occupiedAt,
    plate: r.plate,
  };
}

/**
 * Reserva (o, con occupy=true, ocupa directamente) un espacio. Una fila por visita.
 * Serializa por zona con SELECT ... FOR UPDATE para que la capacidad no se exceda bajo concurrencia.
 * Devuelve parking null (sin aviso) si el tenant no tiene zonas configuradas.
 */
async function reserveInternal(
  tenantId: string,
  visit: VisitLike,
  opts: { zoneId?: string | null; occupy?: boolean; plate?: string | null },
): Promise<ParkingResult> {
  const holdMinutes = await getHoldMinutes(tenantId);
  const now = new Date();
  const occupy = Boolean(opts.occupy);
  const window = occupy
    ? { holdFrom: now, holdUntil: new Date(now.getTime() + holdMinutes * 60000) }
    : computeHoldWindow(visit.validFrom || now, holdMinutes);
  const plate = opts.plate ?? visit.vehiclePlate ?? null;

  // Ventana ya vencida: no se crea una reserva expirada (el ingreso reserva y ocupa si hace falta)
  if (!occupy && window.holdUntil.getTime() < now.getTime()) return { parking: null };

  const result = await prisma.$transaction(async (tx) => {
    await releaseExpired(tenantId, tx);

    let zones;
    if (opts.zoneId) {
      const zone = await tx.visitorParkingZone.findFirst({ where: { id: opts.zoneId, tenantId, isActive: true } });
      if (!zone) return { notFound: true as const };
      zones = [zone];
    } else {
      zones = await tx.visitorParkingZone.findMany({
        where: { tenantId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
    }
    if (zones.length === 0) return { none: true as const };

    for (const zone of zones) {
      // Bloqueo de la zona hasta el commit
      await tx.$queryRaw`SELECT id FROM "VisitorParkingZone" WHERE id = ${zone.id} FOR UPDATE`;

      const active = await tx.visitorParkingReservation.findMany({
        where: { zoneId: zone.id, status: { in: ['RESERVADO', 'OCUPADO'] }, NOT: { visitId: visit.id } },
        select: { zoneId: true, status: true, holdFrom: true, holdUntil: true },
      });
      if (computeZoneOccupancy(active, zone.id, window, now) >= zone.capacity) continue;

      const data = {
        tenantId,
        zoneId: zone.id,
        status: occupy ? 'OCUPADO' : 'RESERVADO',
        holdFrom: window.holdFrom,
        holdUntil: window.holdUntil,
        occupiedAt: occupy ? now : null,
        releasedAt: null,
        plate,
      };
      const reservation = await tx.visitorParkingReservation.upsert({
        where: { visitId: visit.id },
        create: { ...data, visitId: visit.id },
        update: data,
        include: reservationInclude,
      });
      return { reservation };
    }
    return { full: true as const };
  });

  if ('notFound' in result) return { parking: null, parkingWarning: 'La zona de parqueo indicada no existe o no está activa.' };
  if ('none' in result) return { parking: null };
  if ('full' in result) return { parking: null, parkingWarning: WARNING_FULL };
  return { parking: formatReservation(result.reservation) };
}

export async function reserve(
  tenantId: string,
  visit: VisitLike,
  zoneId?: string | null,
): Promise<ParkingResult> {
  try {
    return await reserveInternal(tenantId, visit, { zoneId });
  } catch (error: any) {
    console.error('parking.reserve:', error?.message, error?.code);
    return { parking: null, parkingWarning: WARNING_ERROR };
  }
}

/**
 * Ingreso: RESERVADO pasa a OCUPADO; si la reserva expiró o no existe, se intenta reservar y ocupar.
 */
export async function occupy(
  tenantId: string,
  visit: VisitLike,
  plate?: string | null,
): Promise<ParkingResult> {
  try {
    await releaseExpired(tenantId);
    const current = await prisma.visitorParkingReservation.findFirst({
      where: { visitId: visit.id, tenantId },
      include: reservationInclude,
    });
    if (current?.status === 'OCUPADO') return { parking: formatReservation(current) };
    if (current?.status === 'RESERVADO') {
      const updated = await prisma.visitorParkingReservation.update({
        where: { id: current.id },
        data: { status: 'OCUPADO', occupiedAt: new Date(), plate: plate || current.plate },
        include: reservationInclude,
      });
      return { parking: formatReservation(updated) };
    }
    return await reserveInternal(tenantId, visit, { occupy: true, plate });
  } catch (error: any) {
    console.error('parking.occupy:', error?.message, error?.code);
    return { parking: null, parkingWarning: WARNING_ERROR };
  }
}

async function closeReservation(tenantId: string, visitId: string, status: 'LIBERADO' | 'CANCELADO') {
  try {
    await prisma.visitorParkingReservation.updateMany({
      where: { tenantId, visitId, status: { in: ['RESERVADO', 'OCUPADO'] } },
      data: { status, releasedAt: new Date() },
    });
  } catch (error: any) {
    console.error(`parking.${status}:`, error?.message, error?.code);
  }
}

/** Salida: la reserva pasa a LIBERADO. */
export function release(tenantId: string, visitId: string) {
  return closeReservation(tenantId, visitId, 'LIBERADO');
}

/** Cancelación de la visita: la reserva pasa a CANCELADO. */
export function cancel(tenantId: string, visitId: string) {
  return closeReservation(tenantId, visitId, 'CANCELADO');
}

/**
 * Estado por zona: ocupados, reservados (ventana vigente), próximos y libres, más las reservas activas.
 */
export async function getStatus(tenantId: string) {
  await releaseExpired(tenantId);
  const now = new Date();
  const [zones, reservations, holdMinutes] = await Promise.all([
    prisma.visitorParkingZone.findMany({ where: { tenantId }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] }),
    prisma.visitorParkingReservation.findMany({
      where: { tenantId, status: { in: ['RESERVADO', 'OCUPADO'] } },
      include: reservationInclude,
      orderBy: { holdFrom: 'asc' },
    }),
    getHoldMinutes(tenantId),
  ]);

  const currentWindow = computeHoldWindow(now, holdMinutes);
  const zoneStatus = zones.map((zone) => {
    const mine = reservations.filter((r) => r.zoneId === zone.id);
    const occupied = mine.filter((r) => r.status === 'OCUPADO').length;
    const reserved = mine.filter((r) => r.status === 'RESERVADO' && r.holdFrom <= now).length;
    const upcoming = mine.filter((r) => r.status === 'RESERVADO' && r.holdFrom > now).length;
    return {
      id: zone.id,
      name: zone.name,
      capacity: zone.capacity,
      isActive: zone.isActive,
      occupied,
      reserved,
      upcoming,
      // Mismo criterio que la reserva: OCUPADO + RESERVADO con ventana solapada con la actual
      free: Math.max(0, zone.capacity - computeZoneOccupancy(mine, zone.id, currentWindow, now)),
    };
  });

  return {
    holdMinutes,
    zones: zoneStatus,
    reservations: reservations.map((r) => ({ ...formatReservation(r), visitId: r.visitId })),
  };
}

/** Reservas activas (RESERVADO/OCUPADO) de una zona, tras la expiración perezosa. */
export async function countActiveInZone(tenantId: string, zoneId: string) {
  await releaseExpired(tenantId);
  return prisma.visitorParkingReservation.count({
    where: { tenantId, zoneId, status: { in: ['RESERVADO', 'OCUPADO'] } },
  });
}
