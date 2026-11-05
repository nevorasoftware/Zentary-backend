import { test } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import {
  anonymizeAccount,
  buildAnonymizedUserData,
  deleteOwnAccount,
  DELETED_EMAIL_DOMAIN,
  DELETED_REPORT_TEXT,
  getDeletionSummary,
  notDeletedUser,
  scrubImportReport,
} from './accountDeletion.service.js';
import authRouter from '../routes/auth.routes.js';

type Call = { model: string; method: string; args: any };

// Cliente falso: registra cada llamada y responde con lo mínimo que usa el servicio
const mkTx = (over: { pendingCharges?: number; visitIds?: string[]; vehicleIds?: string[]; imports?: any[]; audits?: any[] } = {}) => {
  const calls: Call[] = [];
  const tx = new Proxy(
    {},
    {
      get: (_t, model: string) =>
        new Proxy(
          {},
          {
            get: (_m, method: string) => async (args: any) => {
              calls.push({ model, method, args });
              if (method === 'findMany' && model === 'visit') return (over.visitIds ?? ['v1']).map((id) => ({ id }));
              if (method === 'findMany' && model === 'vehicle') return (over.vehicleIds ?? ['c1']).map((id) => ({ id }));
              if (method === 'findMany' && model === 'houseImport') return over.imports ?? [];
              if (method === 'findMany' && model === 'auditLog') return over.audits ?? [];
              if (method === 'count') return over.pendingCharges ?? 0;
              return { count: 1 };
            },
          }
        ),
    }
  ) as any;
  return { tx, calls };
};

const user = { id: 'u1', email: 'ana@correo.com', tenantId: 't1', houseId: 'h1' };
const find = (calls: Call[], model: string, method: string) => calls.filter((c) => c.model === model && c.method === method);

test('anonimiza la fila del usuario y libera su correo', () => {
  const data = buildAnonymizedUserData('u1', 'hash');
  assert.equal(data.email, `deleted+u1${DELETED_EMAIL_DOMAIN}`);
  assert.equal(data.password, 'hash');
  assert.equal(data.isActive, false);
  for (const field of ['phone', 'whatsapp', 'documentNumber', 'avatarUrl', 'pushToken', 'houseId'] as const) {
    assert.equal(data[field], null);
  }
  assert.equal(notDeletedUser.NOT.email.endsWith, DELETED_EMAIL_DOMAIN);
});

test('nunca borra la fila de User ni los cobros (registros contables)', async () => {
  const { tx, calls } = mkTx();
  await anonymizeAccount(tx, user, 'hash');
  assert.equal(find(calls, 'user', 'delete').length, 0);
  assert.equal(find(calls, 'user', 'deleteMany').length, 0);
  assert.equal(find(calls, 'payment', 'deleteMany').length, 0);
  assert.equal(find(calls, 'amenityReservation', 'deleteMany').length, 0);
  const [payment] = find(calls, 'payment', 'updateMany');
  assert.deepEqual(payment.args.data, { rawGatewayResponse: null });
});

test('revoca los tokens QR sin borrarlos: un ZNT2 sin fila pasaría la verificación', async () => {
  const { tx, calls } = mkTx({ visitIds: ['v1', 'v2'] });
  await anonymizeAccount(tx, user, 'hash');
  assert.equal(find(calls, 'visitToken', 'deleteMany').length, 0);
  const [revoke] = find(calls, 'visitToken', 'updateMany');
  assert.deepEqual(revoke.args.data, { isRevoked: true });
  assert.deepEqual(revoke.args.where.visitId.in, ['v1', 'v2']);
});

test('los pases se cancelan y pierden los datos del visitante y el enlace público', async () => {
  const { tx, calls } = mkTx();
  await anonymizeAccount(tx, user, 'hash');
  const [cancel, scrub] = find(calls, 'visit', 'updateMany');
  assert.equal(cancel.args.data.status, 'CANCELADA');
  assert.deepEqual(cancel.args.where.status.in, ['PENDIENTE_REGISTRO', 'DATOS_COMPLETADOS']);
  for (const field of ['visitorPhone', 'visitorDni', 'documentNumber', 'documentPhotoUrl', 'vehiclePlate', 'publicToken']) {
    assert.equal(scrub.args.data[field], null, field);
  }
});

test('los ingresos directos en garita no se tratan como pases del residente', async () => {
  const { tx, calls } = mkTx();
  await anonymizeAccount(tx, user, 'hash');
  const [query] = find(calls, 'visit', 'findMany');
  assert.deepEqual(query.args.where, { residentId: 'u1', OR: [{ publicToken: { not: null } }, { guardId: null }] });
});

test('borra los datos personales sin valor contable', async () => {
  const { tx, calls } = mkTx();
  await anonymizeAccount(tx, user, 'hash');
  for (const model of ['vehicle', 'parcel', 'pqrs', 'notification', 'pushDevice', 'frequentAccessConfig']) {
    assert.equal(find(calls, model, 'deleteMany').length, 1, model);
  }
});

test('con saldo pendiente conserva los datos de titular y lo informa', async () => {
  const { tx, calls } = mkTx({ pendingCharges: 2 });
  assert.equal(await anonymizeAccount(tx, user, 'hash'), 2);
  assert.equal(find(calls, 'house', 'updateMany').length, 0);
});

test('sin saldo pendiente limpia los datos de titular que coinciden con su correo', async () => {
  const { tx, calls } = mkTx();
  assert.equal(await anonymizeAccount(tx, user, 'hash'), 0);
  const [house] = find(calls, 'house', 'updateMany');
  assert.deepEqual(house.args.where.ownerEmail, { equals: 'ana@correo.com', mode: 'insensitive' });
  assert.deepEqual(house.args.data, { ownerName: null, ownerPhone: null, ownerEmail: null });
});

test('registra la baja sin datos personales en la bitácora', async () => {
  const { tx, calls } = mkTx();
  await anonymizeAccount(tx, user, 'hash');
  const [audit] = find(calls, 'auditLog', 'create');
  assert.deepEqual(audit.args.data, { tenantId: 't1', userId: 'u1', action: 'DELETE_OWN_ACCOUNT', entity: 'User', entityId: 'u1' });
  const [occupancy] = find(calls, 'houseOccupancyLog', 'create');
  assert.equal(occupancy.args.data.houseId, 'h1');
});

const paidReservation = {
  id: 'r1',
  reservationDate: new Date('2026-11-20T00:00:00Z'),
  startTime: '10:00',
  endTime: '11:00',
  price: 20,
  amenity: { name: 'Salón' },
};

const mkDb = (found: any, paid: any[] = []) => {
  let transactions = 0;
  const { tx } = mkTx();
  return {
    db: {
      user: { findUnique: async () => found },
      payment: { count: async () => 2 },
      amenityReservation: { findMany: async () => paid },
      $transaction: async (fn: any) => {
        transactions++;
        return fn(tx);
      },
    } as any,
    transactions: () => transactions,
  };
};

const hash = bcrypt.hashSync('correcta', 4);

test('exige la contraseña y no toca nada si falta o es incorrecta', async () => {
  const { db, transactions } = mkDb({ ...user, password: hash, role: 'RESIDENT' });
  const missing = await deleteOwnAccount(db, 'u1', undefined);
  assert.deepEqual(missing.ok === false && [missing.status, missing.code], [400, 'MISSING_PASSWORD']);
  const wrong = await deleteOwnAccount(db, 'u1', 'otra');
  assert.deepEqual(wrong.ok === false && [wrong.status, wrong.code], [401, 'INVALID_PASSWORD']);
  assert.equal(transactions(), 0);
});

test('las cuentas de administración no se eliminan desde la app', async () => {
  for (const role of ['SUPER_ADMIN', 'ADMIN', 'RESIDENTIAL_ADMIN', 'SECURITY_ADMIN']) {
    const { db, transactions } = mkDb({ ...user, password: hash, role });
    const result = await deleteOwnAccount(db, 'u1', 'correcta');
    assert.deepEqual(result.ok === false && [result.status, result.code], [403, 'ACCOUNT_DELETION_NOT_ALLOWED']);
    assert.equal(transactions(), 0);
  }
});

test('residente y guardia con contraseña correcta eliminan su cuenta', async () => {
  for (const role of ['RESIDENT', 'GUARD']) {
    const { db, transactions } = mkDb({ ...user, password: hash, role });
    assert.deepEqual(await deleteOwnAccount(db, 'u1', 'correcta'), { ok: true, pendingCharges: 0 });
    assert.equal(transactions(), 1);
  }
});

test('con reservas futuras pagadas exige confirmación explícita y no toca nada', async () => {
  const { db, transactions } = mkDb({ ...user, password: hash, role: 'RESIDENT' }, [paidReservation]);
  for (const confirm of [undefined, false, 'true']) {
    const result = await deleteOwnAccount(db, 'u1', 'correcta', confirm);
    assert.ok(!result.ok);
    assert.equal(result.status, 409);
    assert.equal(result.code, 'PAID_RESERVATIONS_CONFIRMATION_REQUIRED');
    assert.equal(result.paidReservations?.[0].amenityName, 'Salón');
  }
  assert.equal(transactions(), 0);
  assert.equal((await deleteOwnAccount(db, 'u1', 'correcta', true)).ok, true);
  assert.equal(transactions(), 1);
});

test('el resumen informa saldo y reservas pagadas sin modificar nada', async () => {
  const { db, transactions } = mkDb({ role: 'RESIDENT' }, [paidReservation]);
  const summary = await getDeletionSummary(db, 'u1');
  assert.equal(summary?.canDelete, true);
  assert.equal(summary?.pendingCharges, 2);
  assert.deepEqual(summary?.paidReservations[0], {
    id: 'r1',
    reservationDate: '2026-11-19',
    startTime: '10:00',
    endTime: '11:00',
    price: 20,
    amenityName: 'Salón',
  });
  assert.equal(transactions(), 0);
  assert.equal((await getDeletionSummary(mkDb({ role: 'ADMIN' }).db, 'u1'))?.canDelete, false);
  assert.equal(await getDeletionSummary(mkDb(null).db, 'u1'), null);
});

const reportUser = { id: 'u1', email: 'ana@correo.com' };

// 19:00 del 19/11 en El Salvador; en un servidor en UTC ya es 20/11
const evening = new Date('2026-11-20T01:00:00Z');
// Reserva del 19/11 a las 12:00 de El Salvador, como la guarda parseLocalDate
const sameDayReservation = new Date('2026-11-19T18:00:00Z');
const salvadorDayStart = new Date('2026-11-19T06:00:00Z');

test('18:00-24:00 en El Salvador: la reserva de hoy se cancela aunque en UTC ya sea mañana', async () => {
  const { tx, calls } = mkTx();
  await anonymizeAccount(tx, user, 'hash', evening, 'America/El_Salvador');
  const [cancel] = find(calls, 'amenityReservation', 'updateMany');
  assert.equal(cancel.args.data.reservationStatus, 'CANCELLED');
  assert.deepEqual(cancel.args.where.reservationDate.gte, salvadorDayStart);
  assert.ok(sameDayReservation >= cancel.args.where.reservationDate.gte);
});

test('18:00-24:00 en El Salvador: la reserva pagada de hoy se avisa y exige confirmación', async () => {
  let where: any;
  const db: any = {
    user: { findUnique: async () => ({ ...user, password: hash, role: 'RESIDENT', tenant: { timezone: 'America/El_Salvador' } }) },
    payment: { count: async () => 0 },
    amenityReservation: {
      findMany: async (args: any) => {
        where = args.where;
        return args.where.reservationDate.gte <= sameDayReservation
          ? [{ ...paidReservation, reservationDate: sameDayReservation }]
          : [];
      },
    },
    $transaction: async () => assert.fail('no debe eliminar sin confirmación'),
  };
  const result = await deleteOwnAccount(db, 'u1', 'correcta', false, evening);
  assert.ok(!result.ok);
  assert.equal(result.code, 'PAID_RESERVATIONS_CONFIRMATION_REQUIRED');
  assert.equal(result.paidReservations?.[0].reservationDate, '2026-11-19');
  assert.deepEqual(where.reservationDate.gte, salvadorDayStart);
  const summary = await getDeletionSummary(db, 'u1', evening);
  assert.equal(summary?.paidReservations.length, 1);
});

test('la zona es la de la residencial; si es inválida se usa la predeterminada', async () => {
  const calls: any[] = [];
  const mk = (timezone: string) => ({
    user: { findUnique: async () => ({ role: 'RESIDENT', tenant: { timezone } }) },
    payment: { count: async () => 0 },
    amenityReservation: {
      findMany: async (args: any) => {
        calls.push(args.where.reservationDate.gte);
        return [{ ...paidReservation, reservationDate: new Date('2026-11-19T15:30:00Z') }];
      },
    },
  });
  const tokyo = await getDeletionSummary(mk('Asia/Tokyo') as any, 'u1', evening);
  assert.deepEqual(calls[0], new Date('2026-11-19T15:00:00Z'));
  assert.equal(tokyo?.paidReservations[0].reservationDate, '2026-11-20');
  await getDeletionSummary(mk('Zona/Invalida') as any, 'u1', evening);
  assert.deepEqual(calls[1], salvadorDayStart);
});

test('reporte de importación: limpia solo la fila del usuario', () => {
  const report = JSON.stringify([
    { fila: 2, codigo: 'A1', vivienda: 'creada', usuario: 'creado', mensaje: '', usuarioId: 'u1', correo: 'ANA@correo.com', nombre: 'Ana' },
    { fila: 3, codigo: 'B2', vivienda: 'creada', usuario: 'creado', mensaje: '', usuarioId: 'u2', correo: 'bob@correo.com', nombre: 'Bob' },
    { fila: 4, codigo: 'C3', vivienda: 'error', usuario: 'error', mensaje: 'Correo ana@correo.com duplicado' },
  ]);
  const rows = JSON.parse(scrubImportReport(report, reportUser));
  assert.deepEqual(rows[0], { fila: 2, codigo: 'A1', vivienda: 'creada', usuario: 'creado', mensaje: '' });
  assert.deepEqual(rows[1], JSON.parse(report)[1]);
  assert.equal(rows[2].mensaje, `Correo ${DELETED_REPORT_TEXT} duplicado`);
});

test('reporte de importación: un correo que solo contiene al del usuario no se toca', () => {
  const report = JSON.stringify([{ fila: 2, correo: 'mariana@correo.com', nombre: 'Mariana', mensaje: 'x' }]);
  assert.equal(scrubImportReport(report, reportUser), report);
});

test('reporte de importación sin datos del usuario queda idéntico; texto no JSON se enmascara', () => {
  const report = JSON.stringify([{ fila: 2, codigo: 'A1', vivienda: 'creada', usuario: 'ninguno', mensaje: '' }]);
  assert.equal(scrubImportReport(report, reportUser), report);
  assert.equal(scrubImportReport('{"correo":"ana@correo.com","nom', reportUser), `{"correo":"${DELETED_REPORT_TEXT}","nom`);
});

test('anonymizeAccount actualiza el reporte en lugar de borrarlo', async () => {
  const report = JSON.stringify([{ fila: 2, usuarioId: 'u1', correo: 'ana@correo.com', nombre: 'Ana' }, { fila: 3, correo: 'bob@correo.com' }]);
  const { tx, calls } = mkTx({ imports: [{ id: 'i1', report }] });
  await anonymizeAccount(tx, user, 'hash');
  assert.equal(find(calls, 'houseImport', 'updateMany').length, 0);
  const [update] = find(calls, 'houseImport', 'update');
  assert.deepEqual(JSON.parse(update.args.data.report), [{ fila: 2 }, { fila: 3, correo: 'bob@correo.com' }]);
});

test('auditoría: limpia el correo exacto y no uno que solo lo contiene', async () => {
  const { tx, calls } = mkTx({
    audits: [
      { id: 'exacto', details: '{"ownerEmail":"ANA@correo.com"}' },
      { id: 'ajeno', details: '{"ownerEmail":"mariana@correo.com"}' },
      { id: 'dominio', details: '{"ownerEmail":"ana@correo.com.sv"}' },
    ],
  });
  await anonymizeAccount(tx, user, 'hash');
  const [audit] = find(calls, 'auditLog', 'updateMany');
  assert.deepEqual(audit.args.where.OR.at(-1), { id: { in: ['exacto'] } });
});

test('las rutas exigen autenticación antes del controlador', () => {
  for (const [path, method, handler] of [
    ['/delete-account', 'post', 'deleteAccount'],
    ['/delete-account/summary', 'get', 'getDeleteAccountSummary'],
  ] as const) {
    const layer = (authRouter as any).stack.find((l: any) => l.route?.path === path && l.route.methods[method]);
    assert.ok(layer, path);
    const names = layer.route.stack.map((s: any) => s.name);
    assert.equal(names[0], 'authenticateToken');
    assert.equal(names.at(-1), handler);
  }
});
