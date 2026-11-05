import { randomBytes } from 'crypto';
import bcrypt from 'bcryptjs';
import type { Prisma, PrismaClient, ReservationStatus } from '@prisma/client';
import { APP_TIMEZONE, isValidTimezone, todayRangeInZone, zonedDateParts } from '../utils/timezone.js';

/**
 * Eliminación de cuenta solicitada por el propio usuario.
 *
 * La fila de User se anonimiza en lugar de borrarse: Payment, Visit y AmenityReservation tienen
 * onDelete: Cascade sobre el residente, de modo que borrarla destruiría los registros contables, y
 * PqrsMessage y Announcement la referencian con Restrict.
 *
 * Se conserva: cobros y recibos, reservas y la bitácora de garita, sin datos que identifiquen al usuario.
 */

// Dominio reservado (RFC 2606): identifica a las cuentas eliminadas sin agregar columnas al esquema
export const DELETED_EMAIL_DOMAIN = '@deleted.zentary.invalid';
export const DELETED_USER_NAME = 'Usuario eliminado';
export const DELETED_VISITOR_NAME = 'Visitante';
export const DELETED_MESSAGE_TEXT = '[Mensaje eliminado]';
export const DELETED_REPORT_TEXT = '[eliminado]';

// Filtro para excluir cuentas eliminadas de listados y operaciones de administración
export const notDeletedUser = { NOT: { email: { endsWith: DELETED_EMAIL_DOMAIN } } };

// Las cuentas de administración no se eliminan desde la app: una residencial podría quedar sin administrador
export const SELF_DELETABLE_ROLES = ['RESIDENT', 'GUARD'];

const PENDING_CHARGE_STATUSES = ['PENDING', 'PARTIAL', 'OVERDUE'] as const;

export type PaidReservation = {
  id: string;
  amenityName: string;
  // YYYY-MM-DD en la zona de la residencial
  reservationDate: string;
  startTime: string;
  endTime: string;
  price: number;
};

export type AccountDeletionFailure = {
  ok: false;
  status: number;
  code:
    | 'MISSING_PASSWORD'
    | 'INVALID_PASSWORD'
    | 'ACCOUNT_DELETION_NOT_ALLOWED'
    | 'INVALID_TOKEN'
    | 'PAID_RESERVATIONS_CONFIRMATION_REQUIRED';
  message: string;
  paidReservations?: PaidReservation[];
};
export type AccountDeletionResult = { ok: true; pendingCharges: number } | AccountDeletionFailure;

type DeletionDb = Pick<PrismaClient, '$transaction' | 'user' | 'payment' | 'amenityReservation'>;

type DeletableUser = {
  id: string;
  email: string;
  tenantId: string | null;
  houseId: string | null;
};

export const buildAnonymizedUserData = (userId: string, passwordHash: string) => ({
  email: `deleted+${userId}${DELETED_EMAIL_DOMAIN}`,
  password: passwordHash,
  mustChangePassword: false,
  fullName: DELETED_USER_NAME,
  phone: null,
  whatsapp: null,
  documentType: null,
  documentNumber: null,
  avatarUrl: null,
  pushToken: null,
  isActive: false,
  houseId: null,
  propertyId: null,
});

// El correo completo: `ana@correo.com` no coincide dentro de `mariana@correo.com`
export const exactEmailPattern = (email: string, flags = 'i') =>
  new RegExp(`(?<![\\w.+-])${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`, flags);

/**
 * Quita del reporte de importación solo los datos del usuario. Las filas de otras personas no cambian.
 * Los reportes actuales no guardan datos personales; esto cubre los que sí los tengan.
 */
export const scrubImportReport = (report: string, user: { id: string; email: string }): string => {
  const email = user.email.toLowerCase();
  const emailPattern = exactEmailPattern(email, 'gi');
  const redact = (text: string) => text.replace(emailPattern, DELETED_REPORT_TEXT);

  let rows: unknown;
  try {
    rows = JSON.parse(report);
  } catch {
    rows = null;
  }
  if (!Array.isArray(rows)) return redact(report);

  return JSON.stringify(
    rows.map((row) => {
      if (!row || typeof row !== 'object') return row;
      const { usuarioId, correo, nombre, ...rest } = row as Record<string, unknown>;
      const isUserRow = usuarioId === user.id || (typeof correo === 'string' && correo.toLowerCase() === email);
      const base = isUserRow ? rest : (row as Record<string, unknown>);
      return Object.fromEntries(
        Object.entries(base).map(([key, value]) => [key, typeof value === 'string' ? redact(value) : value])
      );
    })
  );
};

const residentialTimezone = (timezone?: string | null) => (isValidTimezone(timezone) ? timezone : APP_TIMEZONE);

const localDay = (date: Date, timezone: string) => {
  const { y, m, d } = zonedDateParts(date, timezone);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
};

// "Hoy" es el de la residencial: reservationDate se guarda según su zona, no la del servidor
const upcomingReservationsWhere = (userId: string, now: Date, timezone: string) => {
  return {
    residentId: userId,
    reservationStatus: { in: ['PENDING', 'CONFIRMED'] as ReservationStatus[] },
    reservationDate: { gte: todayRangeInZone(timezone, now).start },
  };
};

const findPaidUpcomingReservations = async (
  db: DeletionDb,
  userId: string,
  now: Date,
  timezone: string
): Promise<PaidReservation[]> => {
  const reservations = await db.amenityReservation.findMany({
    where: { ...upcomingReservationsWhere(userId, now, timezone), paymentStatus: 'PAID' },
    select: {
      id: true,
      reservationDate: true,
      startTime: true,
      endTime: true,
      price: true,
      amenity: { select: { name: true } },
    },
    orderBy: { reservationDate: 'asc' },
  });
  return reservations.map(({ amenity, reservationDate, ...r }) => ({
    ...r,
    reservationDate: localDay(reservationDate, timezone),
    amenityName: amenity.name,
  }));
};

/**
 * Lo que el usuario debe saber antes de confirmar. No modifica nada.
 */
export const getDeletionSummary = async (db: DeletionDb, userId: string, now: Date = new Date()) => {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, tenant: { select: { timezone: true } } },
  });
  if (!user) return null;
  const [pendingCharges, paidReservations] = await Promise.all([
    db.payment.count({ where: { residentId: userId, status: { in: [...PENDING_CHARGE_STATUSES] } } }),
    findPaidUpcomingReservations(db, userId, now, residentialTimezone(user.tenant?.timezone)),
  ]);
  return { canDelete: SELF_DELETABLE_ROLES.includes(user.role), pendingCharges, paidReservations };
};

/**
 * Elimina los datos personales del usuario dentro de una transacción.
 * Devuelve cuántos cobros siguen pendientes (permanecen asociados a la vivienda).
 */
export const anonymizeAccount = async (
  tx: Prisma.TransactionClient,
  user: DeletableUser,
  passwordHash: string,
  now: Date = new Date(),
  timezone: string = APP_TIMEZONE
): Promise<number> => {
  // Pases creados por el residente. Los ingresos directos en garita (guardId sin publicToken) son
  // bitácora de la residencial: quickEntry puede asignarlos a un residente que no los creó.
  const visits = await tx.visit.findMany({
    where: { residentId: user.id, OR: [{ publicToken: { not: null } }, { guardId: null }] },
    select: { id: true },
  });
  const visitIds = visits.map((v) => v.id);

  const vehicles = await tx.vehicle.findMany({ where: { residentId: user.id }, select: { id: true } });
  const vehicleIds = vehicles.map((v) => v.id);

  // Se revocan en lugar de borrarse: un token ZNT2 sin fila en VisitToken pasa la verificación del QR
  await tx.visitToken.updateMany({ where: { visitId: { in: visitIds } }, data: { isRevoked: true } });
  await tx.visit.updateMany({
    where: { id: { in: visitIds }, status: { in: ['PENDIENTE_REGISTRO', 'DATOS_COMPLETADOS'] } },
    data: { status: 'CANCELADA' },
  });
  await tx.visit.updateMany({
    where: { id: { in: visitIds } },
    data: {
      visitorName: DELETED_VISITOR_NAME,
      visitorPhone: null,
      visitorDni: null,
      documentType: null,
      documentNumber: null,
      documentPhotoUrl: null,
      vehiclePlate: null,
      vehicleModel: null,
      vehicleColor: null,
      notes: null,
      qrCode: null,
      publicToken: null,
    },
  });
  // Las reservas OCUPADO siguen activas: el parqueo se libera al registrar la salida
  await tx.visitorParkingReservation.updateMany({
    where: { visitId: { in: visitIds }, status: 'RESERVADO' },
    data: { status: 'CANCELADO', releasedAt: now },
  });
  await tx.visitorParkingReservation.updateMany({ where: { visitId: { in: visitIds } }, data: { plate: null } });

  await tx.vehicle.deleteMany({ where: { residentId: user.id } });
  await tx.parcel.deleteMany({ where: { residentId: user.id } });
  await tx.pqrs.deleteMany({ where: { residentId: user.id } });
  await tx.pqrsMessage.updateMany({ where: { senderId: user.id }, data: { message: DELETED_MESSAGE_TEXT } });
  await tx.notification.deleteMany({ where: { userId: user.id } });
  await tx.pushDevice.deleteMany({ where: { userId: user.id } });
  await tx.frequentAccessConfig.deleteMany({ where: { userId: user.id } });

  // Reservas: el registro se conserva por su valor contable; las futuras dejan libre el espacio
  await tx.amenityReservation.updateMany({
    where: upcomingReservationsWhere(user.id, now, timezone),
    data: { reservationStatus: 'CANCELLED' },
  });
  await tx.amenityReservation.updateMany({
    where: { residentId: user.id },
    data: { notes: null, rejectionReason: null },
  });

  // Cobros: monto, estado, recibo e id de transacción se conservan; la respuesta cruda de la pasarela no
  await tx.payment.updateMany({ where: { residentId: user.id }, data: { rawGatewayResponse: null } });
  const pendingCharges = await tx.payment.count({
    where: { residentId: user.id, status: { in: [...PENDING_CHARGE_STATUSES] } },
  });

  // Los datos de titular se conservan mientras haya saldo: la residencial debe poder gestionar el cobro
  if (pendingCharges === 0 && user.tenantId) {
    await tx.house.updateMany({
      where: { tenantId: user.tenantId, ownerEmail: { equals: user.email, mode: 'insensitive' } },
      data: { ownerName: null, ownerPhone: null, ownerEmail: null },
    });
  }

  const auditCandidates = await tx.auditLog.findMany({
    where: { details: { contains: user.email, mode: 'insensitive' } },
    select: { id: true, details: true },
  });
  const emailPattern = exactEmailPattern(user.email);
  const auditIdsWithEmail = auditCandidates.filter((a) => a.details && emailPattern.test(a.details)).map((a) => a.id);

  await tx.auditLog.updateMany({
    where: {
      OR: [
        { userId: user.id },
        { entity: 'Visit', entityId: { in: visitIds } },
        { entity: 'Vehicle', entityId: { in: vehicleIds } },
        { id: { in: auditIdsWithEmail } },
      ],
    },
    data: { details: null, ipAddress: null },
  });
  if (user.tenantId) {
    const imports = await tx.houseImport.findMany({
      where: {
        tenantId: user.tenantId,
        OR: [{ report: { contains: user.email, mode: 'insensitive' } }, { report: { contains: user.id } }],
      },
      select: { id: true, report: true },
    });
    for (const item of imports) {
      if (!item.report) continue;
      const report = scrubImportReport(item.report, user);
      if (report !== item.report) await tx.houseImport.update({ where: { id: item.id }, data: { report } });
    }
  }

  if (user.tenantId && user.houseId) {
    await tx.houseOccupancyLog.create({
      data: {
        tenantId: user.tenantId,
        houseId: user.houseId,
        previousUserId: user.id,
        reason: 'Cuenta eliminada por el usuario',
        performedBy: user.id,
      },
    });
  }

  await tx.user.update({ where: { id: user.id }, data: buildAnonymizedUserData(user.id, passwordHash) });

  if (user.tenantId) {
    await tx.auditLog.create({
      data: { tenantId: user.tenantId, userId: user.id, action: 'DELETE_OWN_ACCOUNT', entity: 'User', entityId: user.id },
    });
  }

  return pendingCharges;
};

/**
 * Valida la contraseña y el rol, y anonimiza la cuenta. No es reversible.
 */
export const deleteOwnAccount = async (
  db: DeletionDb,
  userId: string,
  password: unknown,
  confirmPaidReservations: unknown = false,
  now: Date = new Date()
): Promise<AccountDeletionResult> => {
  if (typeof password !== 'string' || !password) {
    return { ok: false, status: 400, code: 'MISSING_PASSWORD', message: 'Ingresa tu contraseña para confirmar.' };
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      password: true,
      role: true,
      tenantId: true,
      houseId: true,
      tenant: { select: { timezone: true } },
    },
  });
  if (!user) {
    return { ok: false, status: 401, code: 'INVALID_TOKEN', message: 'Sesión no válida o token expirado.' };
  }

  if (!(await bcrypt.compare(password, user.password))) {
    return { ok: false, status: 401, code: 'INVALID_PASSWORD', message: 'La contraseña es incorrecta.' };
  }

  if (!SELF_DELETABLE_ROLES.includes(user.role)) {
    return {
      ok: false,
      status: 403,
      code: 'ACCOUNT_DELETION_NOT_ALLOWED',
      message: 'Las cuentas de administración se eliminan a través de soporte de Zentary.',
    };
  }

  // Se cancelan sin reembolso automático: el usuario debe aceptarlo de forma explícita
  const timezone = residentialTimezone(user.tenant?.timezone);
  const paidReservations = await findPaidUpcomingReservations(db, user.id, now, timezone);
  if (paidReservations.length > 0 && confirmPaidReservations !== true) {
    return {
      ok: false,
      status: 409,
      code: 'PAID_RESERVATIONS_CONFIRMATION_REQUIRED',
      message: 'Tus reservas futuras pagadas se cancelarán sin reembolso automático. Confirma para continuar.',
      paidReservations,
    };
  }

  const passwordHash = await bcrypt.hash(randomBytes(32).toString('hex'), 10);
  const pendingCharges = await db.$transaction((tx) => anonymizeAccount(tx, user, passwordHash, now, timezone), { timeout: 30000 });
  return { ok: true, pendingCharges };
};
