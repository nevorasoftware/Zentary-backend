/**
 * Conciliación periódica de pagos y reservas pendientes con la pasarela (Wompi).
 * El job solo selecciona ítems y delega en confirmPaymentWithGateway / confirmReservationWithGateway,
 * que ya implementan la semántica de aprobado/rechazado usada por el webhook y el redirect.
 */

export type GatewayOutcome = 'PAID' | 'PENDING' | 'REJECTED' | 'REVIEW' | 'UNAVAILABLE';

export interface PendingPayment {
  id: string;
  amount: number;
  status: string;
  externalTransactionId: string | null;
}

export interface PendingReservation {
  id: string;
  price: number;
  paymentStatus: string;
  paymentReference: string | null;
}

export interface FindWindow {
  olderThan: Date;
  newerThan: Date;
  take: number;
}

export interface ReconciliationDeps {
  findPendingPayments: (w: FindWindow) => Promise<PendingPayment[]>;
  findPendingReservations: (w: FindWindow) => Promise<PendingReservation[]>;
  confirmPayment: (p: PendingPayment) => Promise<GatewayOutcome>;
  confirmReservation: (r: PendingReservation) => Promise<GatewayOutcome>;
  now: () => Date;
  log: (message: string) => void;
  sleep: (ms: number) => Promise<void>;
}

export const MIN_AGE_MS = 15 * 60 * 1000;
export const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const WINDOW_SIZE = 100;
export const MAX_PER_TYPE = 25;
export const CALL_DELAY_MS = 250;
export const MAX_CONSECUTIVE_UNAVAILABLE = 3;
export const BACKOFF_BASE_MS = 15 * 60 * 1000;
export const BACKOFF_CAP_MS = 6 * 60 * 60 * 1000;

interface BackoffEntry {
  delayMs: number;
  nextAttemptAt: number;
}

// Backoff en memoria (se pierde al reiniciar: aceptable)
const backoff = new Map<string, BackoffEntry>();
let running = false;

export const getBackoffState = () => backoff;
export const resetReconciliationState = () => {
  backoff.clear();
  running = false;
};

export interface ReconciliationSummary {
  skipped: boolean;
  aborted: boolean;
  counts: Record<GatewayOutcome | 'ERROR', number>;
  durationMs: number;
}

const defaultDeps = (): ReconciliationDeps => ({
  findPendingPayments: async ({ olderThan, newerThan, take }) => {
    const { prisma } = await import('../config/prisma.js');
    return prisma.payment.findMany({
      where: {
        status: { in: ['PENDING', 'OVERDUE', 'PARTIAL'] },
        AND: [{ externalTransactionId: { not: null } }, { externalTransactionId: { not: { startsWith: 'WOMPI-' } } }],
        updatedAt: { lt: olderThan, gt: newerThan },
      },
      select: { id: true, amount: true, status: true, externalTransactionId: true },
      orderBy: { updatedAt: 'asc' },
      take,
    });
  },
  findPendingReservations: async ({ olderThan, newerThan, take }) => {
    const { prisma } = await import('../config/prisma.js');
    return prisma.amenityReservation.findMany({
      where: {
        paymentStatus: 'PENDING',
        reservationStatus: 'PENDING',
        AND: [{ paymentReference: { not: null } }, { paymentReference: { not: { startsWith: 'WOMPI-' } } }],
        updatedAt: { lt: olderThan, gt: newerThan },
      },
      select: { id: true, price: true, paymentStatus: true, paymentReference: true },
      orderBy: { updatedAt: 'asc' },
      take,
    });
  },
  confirmPayment: async (p) => {
    const { confirmPaymentWithGateway } = await import('../controllers/payment.controller.js');
    return confirmPaymentWithGateway(p);
  },
  confirmReservation: async (r) => {
    const { confirmReservationWithGateway } = await import('../controllers/amenity.controller.js');
    return confirmReservationWithGateway(r);
  },
  now: () => new Date(),
  log: (message) => console.log(message),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

export const runReconciliation = async (overrides: Partial<ReconciliationDeps> = {}): Promise<ReconciliationSummary> => {
  const deps = { ...defaultDeps(), ...overrides };
  const counts: ReconciliationSummary['counts'] = { PAID: 0, PENDING: 0, REJECTED: 0, REVIEW: 0, UNAVAILABLE: 0, ERROR: 0 };

  if (running) {
    return { skipped: true, aborted: false, counts, durationMs: 0 };
  }
  running = true;
  const startedAt = deps.now().getTime();
  let aborted = false;

  try {
    const nowMs = startedAt;
    const window: FindWindow = {
      olderThan: new Date(nowMs - MIN_AGE_MS),
      newerThan: new Date(nowMs - MAX_AGE_MS),
      take: WINDOW_SIZE,
    };
    const payments = await deps.findPendingPayments(window);
    const reservations = await deps.findPendingReservations(window);

    // Limpia el backoff vencido hace más del tope (expira por tiempo)
    for (const [key, entry] of Array.from(backoff.entries())) {
      if (entry.nextAttemptAt < nowMs - BACKOFF_CAP_MS) backoff.delete(key);
    }

    const due = (key: string) => (backoff.get(key)?.nextAttemptAt ?? 0) <= nowMs;
    const queue: Array<{ key: string; label: string; id: string; txId: string | null; run: () => Promise<GatewayOutcome> }> = [
      ...payments
        .filter((p) => due(`P:${p.id}`))
        .slice(0, MAX_PER_TYPE)
        .map((p) => ({ key: `P:${p.id}`, label: 'Pago', id: p.id, txId: p.externalTransactionId, run: () => deps.confirmPayment(p) })),
      ...reservations
        .filter((r) => due(`R:${r.id}`))
        .slice(0, MAX_PER_TYPE)
        .map((r) => ({ key: `R:${r.id}`, label: 'Reserva', id: r.id, txId: r.paymentReference, run: () => deps.confirmReservation(r) })),
    ];

    let consecutiveUnavailable = 0;
    let first = true;
    for (const item of queue) {
      if (!first) await deps.sleep(CALL_DELAY_MS);
      first = false;

      let outcome: GatewayOutcome;
      try {
        outcome = await item.run();
      } catch {
        counts.ERROR++;
        continue;
      }
      counts[outcome]++;

      if (outcome === 'UNAVAILABLE') {
        // Backoff fijo (sin duplicar) para que la siguiente corrida salte los ítems problemáticos
        backoff.set(item.key, { delayMs: BACKOFF_BASE_MS, nextAttemptAt: nowMs + BACKOFF_BASE_MS });
        consecutiveUnavailable++;
        if (consecutiveUnavailable >= MAX_CONSECUTIVE_UNAVAILABLE) {
          aborted = true;
          break;
        }
        continue;
      }
      consecutiveUnavailable = 0;

      if (outcome === 'PAID' || outcome === 'REVIEW') {
        backoff.delete(item.key);
        deps.log(`[CONCILIACION] ${item.label} ${item.id} -> ${outcome} (idTransaccion ${item.txId})`);
      } else {
        // PENDING / REJECTED: duplica el intervalo hasta el tope
        const prev = backoff.get(item.key)?.delayMs ?? BACKOFF_BASE_MS / 2;
        const delayMs = Math.min(prev * 2, BACKOFF_CAP_MS);
        backoff.set(item.key, { delayMs, nextAttemptAt: nowMs + delayMs });
      }
    }

    const durationMs = deps.now().getTime() - startedAt;
    deps.log(
      `[CONCILIACION] Corrida${aborted ? ' abortada' : ''}: pagados=${counts.PAID} pendientes=${counts.PENDING} rechazados=${counts.REJECTED} revision=${counts.REVIEW} no_disponible=${counts.UNAVAILABLE} errores=${counts.ERROR} duracion=${durationMs}ms`
    );
    return { skipped: false, aborted, counts, durationMs };
  } finally {
    running = false;
  }
};

/**
 * Programa la conciliación periódica. WOMPI_RECONCILE_INTERVAL_MINUTES: 0 = apagado (default 10).
 */
export const startPaymentReconciliation = () => {
  const raw = process.env.WOMPI_RECONCILE_INTERVAL_MINUTES;
  const minutes = raw === undefined || raw.trim() === '' ? 10 : Number(raw);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    console.log('conciliación de pagos desactivada (intervalo en 0 o inválido)');
    return;
  }

  const tick = () => {
    runReconciliation().catch((err: any) => {
      console.error('⚠️ [CONCILIACION] Error en la corrida:', err?.message);
    });
  };
  setTimeout(() => {
    tick();
    setInterval(tick, minutes * 60 * 1000).unref();
  }, 2 * 60 * 1000).unref();
  console.log(`🔁 Conciliación de pagos activa (cada ${minutes} min)`);
};
