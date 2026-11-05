import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLateFeesForTenant } from './lateFees.service.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const TZ = 'America/El_Salvador';

// Base en memoria: updateMany respeta el filtro de status/lateFeeApplied como la real
const mkDb = (payments: any[]) => {
  const houses: Record<string, string> = {};
  return {
    houses,
    payments,
    payment: {
      findMany: async ({ where }: any) =>
        payments.filter((p) => p.status === 'PENDING' && !p.lateFeeApplied && (where.externalTransactionId !== null || p.externalTransactionId == null)),
      updateMany: async ({ where, data }: any) => {
        const p = payments.find((x) => x.id === where.id && x.status === where.status && x.lateFeeApplied === where.lateFeeApplied && x.externalTransactionId == null);
        if (!p) return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      },
    },
    house: { update: async ({ where, data }: any) => void (houses[where.id] = data.financialStatus) },
  };
};

const mkPayment = (over: any = {}) => ({
  id: 'p1', amount: 100, status: 'PENDING', lateFeeApplied: false, houseId: 'h1',
  dueDate: new Date('2026-11-01T00:00:00Z'), graceDays: 3, concept: 'Cuota', resident: null, ...over,
});

test('aplica el recargo según el porcentaje y marca la vivienda MOROSO', async () => {
  const db = mkDb([mkPayment()]);
  const r = await runLateFeesForTenant('t1', 3, 10, db, NOW, TZ);
  assert.equal(r.processedCount, 1);
  assert.equal(db.payments[0].amount, 110);
  assert.equal(db.payments[0].status, 'OVERDUE');
  assert.equal(db.houses.h1, 'MOROSO');
});

test('no duplica el recargo en una segunda corrida', async () => {
  const db = mkDb([mkPayment()]);
  await runLateFeesForTenant('t1', 3, 10, db, NOW, TZ);
  const r = await runLateFeesForTenant('t1', 3, 10, db, NOW, TZ);
  assert.equal(r.processedCount, 0);
  assert.equal(db.payments[0].amount, 110);
});

test('no toca cobros dentro del período de gracia', async () => {
  const db = mkDb([mkPayment({ dueDate: new Date('2026-11-09T00:00:00Z') })]);
  const r = await runLateFeesForTenant('t1', 3, 10, db, NOW, TZ);
  assert.equal(r.processedCount, 0);
  assert.equal(db.payments[0].status, 'PENDING');
});

test('no aplica recargo a un cobro con transacción de pago en curso', async () => {
  const db = mkDb([mkPayment({ externalTransactionId: 'tx1' })]);
  const r = await runLateFeesForTenant('t1', 3, 10, db, NOW, TZ);
  assert.equal(r.processedCount, 0);
  assert.equal(db.payments[0].amount, 100);
});

test('la gracia dura hasta el final del día local (El Salvador, UTC-6)', async () => {
  // vence 2026-11-06 + 3 días: corte a las 00:00 locales del 10-nov = 06:00 UTC
  const mk = () => mkDb([mkPayment({ dueDate: new Date('2026-11-06T00:00:00Z') })]);
  const antes = mk();
  assert.equal((await runLateFeesForTenant('t1', 3, 10, antes, new Date('2026-11-10T05:59:00Z'), TZ)).processedCount, 0);
  const despues = mk();
  assert.equal((await runLateFeesForTenant('t1', 3, 10, despues, new Date('2026-11-10T06:00:00Z'), TZ)).processedCount, 1);
});
