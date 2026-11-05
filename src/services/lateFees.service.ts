import { prisma } from '../config/prisma.js';
import { sendPushNotification } from './pushNotification.service.js';
import { logAuditEvent } from './audit.service.js';
import { getTenantTimezone, zonedDateParts, zonedToUtc } from '../utils/timezone.js';

/**
 * Motor de mora: marca OVERDUE los cobros PENDING vencidos (dueDate + graceDays), aplica el recargo
 * una sola vez por cobro y deja la vivienda en MOROSO. Lo usan el endpoint manual y el job diario.
 */
export interface LateFeesResult {
  processedCount: number;
  totalLateFeesApplied: number;
  affectedHouseIds: string[];
}

export const runLateFeesForTenant = async (
  tenantId: string | undefined,
  graceDays: number,
  percent: number,
  db: any = prisma,
  now: Date = new Date(),
  tz?: string
): Promise<LateFeesResult> => {
  const zone = tz ?? (await getTenantTimezone(tenantId));
  const pendingPayments = await db.payment.findMany({
    where: {
      status: 'PENDING',
      lateFeeApplied: false,
      externalTransactionId: null, // un cobro con transacción en curso no recibe recargo
      ...(tenantId ? { tenantId } : {}),
    },
    include: {
      house: true,
      resident: { select: { fullName: true, pushToken: true } },
    },
  });

  let processedCount = 0;
  let totalLateFeesApplied = 0;
  const affectedHouseIds = new Set<string>();

  for (const payment of pendingPayments) {
    // La gracia dura hasta el final del día dueDate + graceDays en hora local de la residencial
    const due = zonedDateParts(new Date(payment.dueDate), 'UTC');
    const effectiveCutoff = zonedToUtc(due.y, due.m, due.d + (payment.graceDays ?? graceDays) + 1, 0, 0, zone);

    if (now >= effectiveCutoff) {
      const calculatedFee = Math.round(payment.amount * (Number(percent) / 100) * 100) / 100;
      const newTotalAmount = Math.round((payment.amount + calculatedFee) * 100) / 100;

      // Condicional: si otra corrida ya lo marcó, no se aplica el recargo dos veces
      const { count } = await db.payment.updateMany({
        where: { id: payment.id, status: 'PENDING', lateFeeApplied: false, externalTransactionId: null },
        data: {
          status: 'OVERDUE',
          lateFee: calculatedFee,
          amount: newTotalAmount,
          lateFeeApplied: true,
        },
      });
      if (count === 0) continue;

      processedCount++;
      totalLateFeesApplied += calculatedFee;

      if (payment.houseId) {
        affectedHouseIds.add(payment.houseId);
      }

      if (payment.resident?.pushToken) {
        sendPushNotification(
          payment.resident.pushToken,
          '⚠️ Cuota Vencida con Recargo de Mora',
          `Tu cobro "${payment.concept}" superó el período de gracia. Se aplicó recargo de mora ($${calculatedFee}).`,
          { type: 'PAYMENT_OVERDUE', paymentId: payment.id }
        );
      }
    }
  }

  // Actualizar estado de las viviendas afectadas a MOROSO
  for (const houseId of affectedHouseIds) {
    await db.house.update({
      where: { id: houseId },
      data: { financialStatus: 'MOROSO' },
    });
  }

  return {
    processedCount,
    totalLateFeesApplied,
    affectedHouseIds: Array.from(affectedHouseIds),
  };
};

/** Corrida diaria sobre todos los residenciales activos, con su propia configuración. */
export const runLateFeesAllTenants = async () => {
  const tenants = await prisma.tenant.findMany({
    where: { isActive: true },
    select: { id: true, settings: { select: { defaultGraceDays: true, defaultLateFeePercent: true } } },
  });
  for (const t of tenants) {
    try {
      const r = await runLateFeesForTenant(
        t.id,
        t.settings?.defaultGraceDays ?? 3,
        t.settings?.defaultLateFeePercent ?? 5.0
      );
      console.log(`⏰ [MORA] ${t.id}: ${r.processedCount} cobro(s), ${r.affectedHouseIds.length} vivienda(s)`);
      if (r.processedCount > 0) {
        await logAuditEvent({
          tenantId: t.id,
          action: 'APPLY_LATE_FEES',
          entity: 'PAYMENT',
          details: { ...r, auto: true },
          result: 'SUCCESS',
        });
      }
    } catch (err: any) {
      console.error(`⚠️ [MORA] Error en ${t.id}:`, err?.message);
    }
  }
};

/** Programa el job de mora. LATE_FEES_INTERVAL_HOURS: 0 = apagado (default 0). */
export const startLateFeesJob = () => {
  const raw = process.env.LATE_FEES_INTERVAL_HOURS;
  const hours = raw === undefined || raw.trim() === '' ? 0 : Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    console.log('mora automática desactivada (intervalo en 0 o inválido)');
    return;
  }
  const tick = () => {
    runLateFeesAllTenants().catch((err: any) => console.error('⚠️ [MORA] Error en la corrida:', err?.message));
  };
  setTimeout(() => {
    tick();
    setInterval(tick, hours * 60 * 60 * 1000).unref();
  }, 5 * 60 * 1000).unref();
  console.log(`⏰ Mora automática activa (cada ${hours} h)`);
};
