import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  runReconciliation,
  startPaymentReconciliation,
  resetReconciliationState,
  getBackoffState,
  MAX_PER_TYPE,
  MIN_AGE_MS,
  MAX_AGE_MS,
  BACKOFF_CAP_MS,
  type ReconciliationDeps,
  type PendingPayment,
} from './paymentReconciliation.service.js';

const mkPayments = (n: number): PendingPayment[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, amount: 100, status: 'PENDING', externalTransactionId: `tx${i}` }));

const T0 = new Date('2026-10-23T12:00:00Z');

const mkDeps = (over: Partial<ReconciliationDeps> = {}, logs: string[] = []): ReconciliationDeps => ({
  findPendingPayments: async () => [],
  findPendingReservations: async () => [],
  confirmPayment: async () => 'PENDING',
  confirmReservation: async () => 'PENDING',
  now: () => T0,
  log: (m) => logs.push(m),
  sleep: async () => {},
  ...over,
});

beforeEach(() => resetReconciliationState());

test('respeta el tope por tipo y corrida', async () => {
  let calls = 0;
  const s = await runReconciliation(
    mkDeps({ findPendingPayments: async () => mkPayments(100), confirmPayment: async () => (calls++, 'PAID') })
  );
  assert.equal(calls, MAX_PER_TYPE);
  assert.equal(s.counts.PAID, MAX_PER_TYPE);
});

test('pasa la edad mínima y la ventana de 7 días a la consulta', async () => {
  let w: any;
  await runReconciliation(mkDeps({ findPendingPayments: async (x) => ((w = x), []) }));
  assert.equal(w.olderThan.getTime(), T0.getTime() - MIN_AGE_MS);
  assert.equal(w.newerThan.getTime(), T0.getTime() - MAX_AGE_MS);
});

test('no reentra mientras otra corrida sigue activa', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const first = runReconciliation(
    mkDeps({ findPendingPayments: async () => mkPayments(1), confirmPayment: async () => (await gate, 'PAID') })
  );
  await new Promise((r) => setImmediate(r));
  const second = await runReconciliation(mkDeps());
  assert.equal(second.skipped, true);
  release();
  assert.equal((await first).skipped, false);
});

test('aborta tras 3 UNAVAILABLE seguidos', async () => {
  let calls = 0;
  const s = await runReconciliation(
    mkDeps({ findPendingPayments: async () => mkPayments(10), confirmPayment: async () => (calls++, 'UNAVAILABLE') })
  );
  assert.equal(calls, 3);
  assert.equal(s.aborted, true);
  assert.equal(getBackoffState().size, 3);
  // La siguiente corrida salta los 3 ítems con backoff y llega a otros
  const ids: string[] = [];
  await runReconciliation(
    mkDeps({ findPendingPayments: async () => mkPayments(10), confirmPayment: async (p) => (ids.push(p.id), 'UNAVAILABLE') })
  );
  assert.deepEqual(ids, ['p3', 'p4', 'p5']);
});

test('el backoff crece, respeta el tope y se limpia', async () => {
  let now = T0.getTime();
  const deps = mkDeps({ findPendingPayments: async () => mkPayments(1), now: () => new Date(now) });
  const delays: number[] = [];
  for (let i = 0; i < 12; i++) {
    await runReconciliation(deps);
    const e = getBackoffState().get('P:p0')!;
    delays.push(e.delayMs);
    now = e.nextAttemptAt;
  }
  assert.equal(delays[0], 15 * 60 * 1000);
  assert.equal(delays[1], 30 * 60 * 1000);
  assert.equal(delays[2], 60 * 60 * 1000);
  assert.equal(Math.max(...delays), BACKOFF_CAP_MS);
  // Antes de nextAttemptAt no se reintenta
  now -= 1;
  let calls = 0;
  await runReconciliation({ ...deps, confirmPayment: async () => (calls++, 'PENDING') });
  assert.equal(calls, 0);
  // Que no salga en la consulta no borra el backoff
  await runReconciliation(mkDeps());
  assert.equal(getBackoffState().size, 1);
  // Expira por tiempo, pasado el tope
  now += BACKOFF_CAP_MS + 2;
  await runReconciliation({ ...deps, findPendingPayments: async () => [] });
  assert.equal(getBackoffState().size, 0);
});

test('los logs no incluyen correos ni montos', async () => {
  const logs: string[] = [];
  await runReconciliation(
    mkDeps(
      {
        findPendingPayments: async () => [{ id: 'p1', amount: 98765.43, status: 'PENDING', externalTransactionId: 'tx1' }],
        confirmPayment: async () => 'PAID',
      },
      logs
    )
  );
  const all = logs.join('\n');
  assert.ok(all.includes('p1') && all.includes('tx1'));
  assert.ok(!all.includes('98765') && !all.includes('@'));
});

test('startPaymentReconciliation arranca sin credenciales de Wompi en el entorno', () => {
  const saved = { ...process.env };
  const origLog = console.log;
  const logs: string[] = [];
  console.log = (m: string) => void logs.push(String(m));
  try {
    delete process.env.WOMPI_CLIENT_ID;
    delete process.env.WOMPI_CLIENT_SECRET;
    delete process.env.WOMPI_RECONCILE_INTERVAL_MINUTES;
    startPaymentReconciliation();
    assert.ok(logs.some((l) => l.includes('Conciliación de pagos activa')));
    logs.length = 0;
    process.env.WOMPI_RECONCILE_INTERVAL_MINUTES = '0';
    startPaymentReconciliation();
    assert.ok(logs.some((l) => l.includes('desactivada (intervalo')));
  } finally {
    console.log = origLog;
    process.env = saved;
  }
});
