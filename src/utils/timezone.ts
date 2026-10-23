import { prisma } from '../config/prisma.js';

const DEFAULT_TIMEZONE = 'America/El_Salvador';

function resolveTimezone(): string {
  const tz = process.env.APP_TIMEZONE || DEFAULT_TIMEZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    console.warn(`APP_TIMEZONE inválida ("${tz}"), se usa ${DEFAULT_TIMEZONE}`);
    return DEFAULT_TIMEZONE;
  }
}

export const APP_TIMEZONE = resolveTimezone();

// Componentes de fecha/hora de un instante, vistos en la zona indicada
export function zonedDateParts(date: Date, tz: string) {
  const { y, m, d } = zonedParts(date, tz);
  return { y, m, d };
}

function zonedParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date);
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  return { y: get('year'), m: get('month'), d: get('day'), h: get('hour'), mi: get('minute'), s: get('second') };
}

// Convierte una fecha/hora de pared en la zona `tz` al instante UTC equivalente
export function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string = APP_TIMEZONE): Date {
  const wall = Date.UTC(y, m - 1, d, h, mi, 0, 0);
  let utc = wall;
  // Dos pasadas para resolver correctamente cambios de horario (DST)
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(utc), tz);
    utc = wall - (Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - utc);
  }
  return new Date(utc);
}

// Inicio y fin del día actual (00:00:00.000 - 23:59:59.999) en la zona `tz`
export function todayRangeInZone(tz: string = APP_TIMEZONE, now: Date = new Date()) {
  const { y, m, d } = zonedParts(now, tz);
  const start = zonedToUtc(y, m, d, 0, 0, tz);
  const end = new Date(zonedToUtc(y, m, d + 1, 0, 0, tz).getTime() - 1);
  return { start, end };
}

export function formatTimeInZone(date: Date, tz: string = APP_TIMEZONE): string {
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: tz });
}

// Indica si `tz` es un identificador IANA válido
export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// Zona horaria configurada en la residencial; si falta o es inválida, usa APP_TIMEZONE
export async function getTenantTimezone(tenantId?: string | null): Promise<string> {
  if (!tenantId) return APP_TIMEZONE;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
  return isValidTimezone(tenant?.timezone) ? tenant!.timezone : APP_TIMEZONE;
}
