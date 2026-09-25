import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { createWompi3DsPurchase } from '../services/wompi.service.js';
import { sendPushNotification } from '../services/pushNotification.service.js';
import { logAuditEvent } from '../services/audit.service.js';

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://zentary-backend-production.up.railway.app';

/**
 * Helper to resolve tenantId across headers, token, user record or fallback
 */
const resolveTenantId = async (req: AuthRequest): Promise<string | undefined> => {
  if (req.tenantId) return req.tenantId;
  if (req.user?.tenantId) return req.user.tenantId;
  const headerTenant = req.headers['x-tenant-id'] as string;
  if (headerTenant) return headerTenant;
  if (req.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { tenantId: true, communityId: true },
    });
    if (user?.tenantId) return user.tenantId;
    if (user?.communityId) return user.communityId;
  }
  const defaultTenant = await prisma.tenant.findFirst({ select: { id: true } });
  return defaultTenant?.id;
};

/**
 * Recalculate financial status of a house (AL_DIA vs MOROSO)
 */
const refreshHouseFinancialStatus = async (houseId?: string | null, residentId?: string) => {
  try {
    let targetHouseId = houseId;
    if (!targetHouseId && residentId) {
      const user = await prisma.user.findUnique({
        where: { id: residentId },
        select: { houseId: true },
      });
      targetHouseId = user?.houseId;
    }
    if (!targetHouseId) return;

    const overdueCount = await prisma.payment.count({
      where: {
        houseId: targetHouseId,
        status: 'OVERDUE',
      },
    });

    const newStatus = overdueCount > 0 ? 'MOROSO' : 'SOLVENTE';
    await prisma.house.update({
      where: { id: targetHouseId },
      data: { financialStatus: newStatus },
    });
  } catch (err) {
    console.error('Error refreshing house financial status:', err);
  }
};

/**
 * GET /api/payments
 * Obtener lista de cobros/pagos del usuario autenticado.
 * Si el usuario no posee cobros en la BD, se autogenera un cobro inicial.
 */
export const getPayments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    let payments = await prisma.payment.findMany({
      where: { residentId: userId },
      orderBy: { dueDate: 'desc' },
      include: {
        house: {
          select: {
            id: true,
            unitNumber: true,
            block: true,
            financialStatus: true,
          },
        },
        property: {
          select: {
            unitNumber: true,
            block: true,
          },
        },
      },
    });

    // Si el residente aún no posee cobros en BD, crear el cobro inicial
    if (payments.length === 0) {
      const defaultDueDate = new Date();
      defaultDueDate.setDate(defaultDueDate.getDate() + 7);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { property: true, house: true },
      });

      const tenantId = user?.tenantId || (await resolveTenantId(req));

      const newPayment = await prisma.payment.create({
        data: {
          residentId: userId,
          tenantId,
          houseId: user?.houseId || null,
          propertyId: user?.property?.id || null,
          concept: 'Cuota de Mantenimiento',
          amount: 85.0,
          currency: 'USD',
          dueDate: defaultDueDate,
          status: 'PENDING',
          periodMonth: defaultDueDate.getMonth() + 1,
          periodYear: defaultDueDate.getFullYear(),
        },
        include: {
          house: {
            select: {
              id: true,
              unitNumber: true,
              block: true,
              financialStatus: true,
            },
          },
          property: {
            select: {
              unitNumber: true,
              block: true,
            },
          },
        },
      });
      payments = [newPayment];
    }

    return res.json({ success: true, payments });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener la lista de pagos', error: error.message });
  }
};

/**
 * GET /api/payments/statement
 * Estado de cuenta detallado para residente o admin (Fase 4 - Sección 29 Spec)
 */
export const getAccountStatement = async (req: AuthRequest, res: Response) => {
  try {
    const userId = (req.query.residentId as string) || req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        house: true,
        property: true,
      },
    });

    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });

    const payments = await prisma.payment.findMany({
      where: {
        OR: [
          { residentId: userId },
          ...(user.houseId ? [{ houseId: user.houseId }] : []),
        ],
      },
      orderBy: { dueDate: 'desc' },
      include: {
        house: { select: { unitNumber: true, block: true, financialStatus: true } },
      },
    });

    let balancePending = 0;
    let balanceOverdue = 0;
    let totalLateFees = 0;
    let totalPaid = 0;

    payments.forEach((p) => {
      if (p.status === 'PAID') {
        totalPaid += p.amount;
      } else if (p.status === 'OVERDUE') {
        balanceOverdue += p.amount;
        totalLateFees += p.lateFee || 0;
      } else if (p.status === 'PENDING' || p.status === 'PARTIAL') {
        balancePending += p.amount;
      }
    });

    return res.json({
      success: true,
      statement: {
        resident: {
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          phone: user.phone,
        },
        house: user.house
          ? {
              id: user.house.id,
              unitNumber: user.house.unitNumber,
              block: user.house.block,
              financialStatus: user.house.financialStatus,
            }
          : null,
        financialStatus: user.house?.financialStatus || (balanceOverdue > 0 ? 'MOROSO' : 'SOLVENTE'),
        balancePending,
        balanceOverdue,
        totalBalanceDue: balancePending + balanceOverdue,
        totalLateFees,
        totalPaid,
        payments,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener estado de cuenta', error: error.message });
  }
};

/**
 * GET /api/payments/admin/all
 * Obtener lista completa de pagos para el portal administrativo con filtros y aislamiento multi-tenant
 */
export const getAllPaymentsAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    const { status, houseId, search } = req.query;

    const where: any = {};
    if (tenantId) where.tenantId = tenantId;
    if (status && typeof status === 'string' && status !== 'ALL') {
      where.status = status;
    }
    if (houseId && typeof houseId === 'string' && houseId !== 'ALL') {
      where.houseId = houseId;
    }
    if (search && typeof search === 'string') {
      where.OR = [
        { concept: { contains: search, mode: 'insensitive' } },
        { resident: { fullName: { contains: search, mode: 'insensitive' } } },
        { house: { unitNumber: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const payments = await prisma.payment.findMany({
      where,
      orderBy: { dueDate: 'desc' },
      include: {
        resident: {
          select: {
            id: true,
            fullName: true,
            email: true,
            phone: true,
          },
        },
        house: {
          select: {
            id: true,
            unitNumber: true,
            block: true,
            financialStatus: true,
          },
        },
        property: {
          select: {
            unitNumber: true,
            block: true,
          },
        },
      },
    });

    return res.json({ success: true, payments });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener todos los pagos', error: error.message });
  }
};

/**
 * GET /api/payments/admin/financial-summary
 * Métricas financieras y de recaudación para el Dashboard de Administración
 */
export const getFinancialSummary = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    const where: any = tenantId ? { tenantId } : {};

    const payments = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        resident: { select: { fullName: true } },
        house: { select: { unitNumber: true, block: true } },
      },
    });

    let totalCollected = 0;
    let totalPending = 0;
    let totalOverdue = 0;
    let totalLateFees = 0;
    let paidCount = 0;
    let pendingCount = 0;
    let overdueCount = 0;

    payments.forEach((p) => {
      if (p.status === 'PAID') {
        totalCollected += p.amount;
        paidCount++;
      } else if (p.status === 'OVERDUE') {
        totalOverdue += p.amount;
        totalLateFees += p.lateFee || 0;
        overdueCount++;
      } else if (p.status === 'PENDING' || p.status === 'PARTIAL') {
        totalPending += p.amount;
        pendingCount++;
      }
    });

    const totalBilled = totalCollected + totalPending + totalOverdue;
    const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 1000) / 10 : 0;

    const morososHousesCount = await prisma.house.count({
      where: {
        ...(tenantId ? { tenantId } : {}),
        financialStatus: 'MOROSO',
      },
    });

    return res.json({
      success: true,
      summary: {
        totalCollected,
        totalPending,
        totalOverdue,
        totalLateFees,
        totalBilled,
        collectionRate,
        paidCount,
        pendingCount,
        overdueCount,
        morososHousesCount,
        totalPayments: payments.length,
        recentPayments: payments.slice(0, 5),
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener resumen financiero', error: error.message });
  }
};

/**
 * POST /api/payments / POST /api/payments/admin/create-charge
 * Crear una nueva solicitud de cobro masiva o individual
 */
export const createPaymentRequest = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    const {
      concept,
      amount,
      currency,
      dueDate,
      propertyId,
      houseId,
      targetResidentId,
      graceDays,
      periodMonth,
      periodYear,
      notes,
    } = req.body;

    if (!concept || !amount || !dueDate) {
      return res.status(400).json({ success: false, message: 'Concepto, monto y fecha límite son requeridos.' });
    }

    let parsedDueDate: Date;
    try {
      parsedDueDate = new Date(dueDate);
      if (isNaN(parsedDueDate.getTime())) {
        parsedDueDate = new Date();
        parsedDueDate.setDate(parsedDueDate.getDate() + 7);
      }
    } catch {
      parsedDueDate = new Date();
      parsedDueDate.setDate(parsedDueDate.getDate() + 7);
    }

    const parsedGraceDays = typeof graceDays === 'number' ? graceDays : 3;
    const parsedMonth = periodMonth ? parseInt(String(periodMonth), 10) : parsedDueDate.getMonth() + 1;
    const parsedYear = periodYear ? parseInt(String(periodYear), 10) : parsedDueDate.getFullYear();

    // 1. Cobro dirigido a un residente o vivienda específica
    if (targetResidentId && targetResidentId !== 'ALL') {
      const resident = await prisma.user.findUnique({
        where: { id: targetResidentId },
        include: { house: true, property: true },
      });

      const payment = await prisma.payment.create({
        data: {
          tenantId: tenantId || resident?.tenantId,
          residentId: targetResidentId,
          houseId: houseId || resident?.houseId || null,
          propertyId: propertyId || resident?.propertyId || null,
          concept,
          amount: parseFloat(amount),
          currency: currency || 'USD',
          dueDate: parsedDueDate,
          graceDays: parsedGraceDays,
          periodMonth: parsedMonth,
          periodYear: parsedYear,
          notes: notes || null,
          status: 'PENDING',
        },
      });

      if (resident?.pushToken) {
        sendPushNotification(
          resident.pushToken,
          '💳 Nuevo Cobro Emitido',
          `Se ha emitido "${concept}" por $${amount}. Vence el ${parsedDueDate.toLocaleDateString()}.`,
          { type: 'PAYMENT', paymentId: payment.id }
        );
      }

      return res.status(201).json({ success: true, message: 'Cobro creado exitosamente para el residente.', payment });
    }

    // 2. Cobro Masivo a todas las viviendas/residentes del tenant
    const residents = await prisma.user.findMany({
      where: {
        role: 'RESIDENT',
        ...(tenantId ? { tenantId } : {}),
      },
      include: { house: true, property: true },
    });

    if (residents.length === 0) {
      const fallbackResident = await prisma.user.findFirst({ where: { role: 'RESIDENT' } });
      const payment = await prisma.payment.create({
        data: {
          tenantId,
          residentId: fallbackResident?.id || req.user?.id || 'admin-fallback',
          concept,
          amount: parseFloat(amount),
          currency: currency || 'USD',
          dueDate: parsedDueDate,
          graceDays: parsedGraceDays,
          periodMonth: parsedMonth,
          periodYear: parsedYear,
          notes: notes || null,
          status: 'PENDING',
        },
      });
      return res.status(201).json({ success: true, message: 'Cobro registrado en BD PostgreSQL', payment });
    }

    const createdPayments = await Promise.all(
      residents.map((r) =>
        prisma.payment.create({
          data: {
            tenantId: tenantId || r.tenantId,
            residentId: r.id,
            houseId: r.houseId || null,
            propertyId: r.propertyId || null,
            concept,
            amount: parseFloat(amount),
            currency: currency || 'USD',
            dueDate: parsedDueDate,
            graceDays: parsedGraceDays,
            periodMonth: parsedMonth,
            periodYear: parsedYear,
            notes: notes || null,
            status: 'PENDING',
          },
        })
      )
    );

    // Broadcast push notification
    residents.forEach((r) => {
      if (r.pushToken) {
        sendPushNotification(
          r.pushToken,
          '💳 Nueva Cuota de Mantenimiento',
          `Se ha emitido "${concept}" por $${amount}. Vence el ${parsedDueDate.toLocaleDateString()}.`,
          { type: 'PAYMENT' }
        );
      }
    });

    return res.status(201).json({
      success: true,
      message: `Cobro masivo emitido exitosamente a ${createdPayments.length} residentes.`,
      count: createdPayments.length,
      payments: createdPayments,
    });
  } catch (error: any) {
    console.error('❌ Error al crear cobro:', error);
    return res.status(500).json({ success: false, message: 'Error al crear la solicitud de pago', error: error.message });
  }
};

/**
 * POST /api/payments/admin/apply-late-fees
 * Motor de Mora Automática (Fase 4 - Sección 27 Spec)
 * Aplica recargo de mora a todos los cobros PENDING cuya fecha (dueDate + graceDays) ya venció.
 * Actualiza el estado de la vivienda a 'MOROSO'.
 */
export const applyLateFees = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    const { lateFeePercent = 5.0, defaultGraceDays = 3 } = req.body;

    const now = new Date();

    // Obtener cobros PENDING no morosos aún
    const pendingPayments = await prisma.payment.findMany({
      where: {
        status: 'PENDING',
        lateFeeApplied: false,
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
      const graceDays = payment.graceDays ?? defaultGraceDays;
      const effectiveCutoff = new Date(payment.dueDate);
      effectiveCutoff.setDate(effectiveCutoff.getDate() + graceDays);

      if (now > effectiveCutoff) {
        const calculatedFee = Math.round(payment.amount * (Number(lateFeePercent) / 100) * 100) / 100;
        const newTotalAmount = Math.round((payment.amount + calculatedFee) * 100) / 100;

        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'OVERDUE',
            lateFee: calculatedFee,
            amount: newTotalAmount,
            lateFeeApplied: true,
          },
        });

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
      await prisma.house.update({
        where: { id: houseId },
        data: { financialStatus: 'MOROSO' },
      });
    }

    if (tenantId) {
      await logAuditEvent({
        tenantId,
        userId: req.user?.id,
        action: 'APPLY_LATE_FEES',
        entity: 'PAYMENT',
        details: { processedCount, totalLateFeesApplied, affectedHouses: Array.from(affectedHouseIds) },
        result: 'SUCCESS',
      });
    }

    return res.json({
      success: true,
      message: `Cálculo de mora completado. Se aplicó recargo a ${processedCount} cobro(s).`,
      processedCount,
      totalLateFeesApplied: Math.round(totalLateFeesApplied * 100) / 100,
      affectedHousesCount: affectedHouseIds.size,
    });
  } catch (error: any) {
    console.error('❌ Error aplicando mora automática:', error);
    return res.status(500).json({ success: false, message: 'Error al aplicar mora automática', error: error.message });
  }
};

/**
 * POST /api/payments/admin/register-manual-payment
 * Registrar un pago manual (Efectivo, Transferencia, Tarjeta física) con comprobante
 */
export const registerManualPayment = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);
    const adminUserId = req.user?.id;
    const {
      paymentId,
      residentId,
      houseId,
      amount,
      paymentMethod = 'TRANSFER',
      receiptUrl,
      notes,
      concept,
    } = req.body;

    let targetPayment = null;

    if (paymentId) {
      targetPayment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { resident: true, house: true },
      });
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Monto de pago inválido.' });
    }

    const now = new Date();

    if (targetPayment) {
      // Liquidar cobro existente
      targetPayment = await prisma.payment.update({
        where: { id: targetPayment.id },
        data: {
          status: 'PAID',
          paidAt: now,
          paymentMethod: paymentMethod.toUpperCase(),
          receiptUrl: receiptUrl || targetPayment.receiptUrl,
          notes: notes ? `${targetPayment.notes ? targetPayment.notes + ' | ' : ''}${notes}` : targetPayment.notes,
          confirmedByUserId: adminUserId,
          confirmedAt: now,
        },
        include: { resident: true, house: true },
      });
    } else {
      // Crear y liquidar nuevo cobro directo
      if (!residentId) {
        return res.status(400).json({ success: false, message: 'Se requiere ID de pago o ID de residente.' });
      }

      targetPayment = await prisma.payment.create({
        data: {
          tenantId,
          residentId,
          houseId: houseId || null,
          concept: concept || 'Abono Cuota de Mantenimiento',
          amount: parsedAmount,
          currency: 'USD',
          dueDate: now,
          status: 'PAID',
          paidAt: now,
          paymentMethod: paymentMethod.toUpperCase(),
          receiptUrl: receiptUrl || null,
          notes: notes || null,
          confirmedByUserId: adminUserId,
          confirmedAt: now,
        },
        include: { resident: true, house: true },
      });
    }

    // Actualizar solvencia de la vivienda
    await refreshHouseFinancialStatus(targetPayment.houseId, targetPayment.residentId);

    // Notificar al residente
    if (targetPayment.resident?.pushToken) {
      sendPushNotification(
        targetPayment.resident.pushToken,
        '✅ Pago Confirmado por Administración',
        `Tu pago de $${targetPayment.amount} (${targetPayment.concept}) ha sido verificado y aprobado.`,
        { type: 'PAYMENT_CONFIRMED', paymentId: targetPayment.id }
      );
    }

    if (tenantId) {
      await logAuditEvent({
        tenantId,
        userId: adminUserId,
        action: 'REGISTER_MANUAL_PAYMENT',
        entity: 'PAYMENT',
        entityId: targetPayment.id,
        details: { amount: parsedAmount, method: paymentMethod, receiptUrl },
        result: 'SUCCESS',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Pago registrado y confirmado exitosamente.',
      payment: targetPayment,
    });
  } catch (error: any) {
    console.error('❌ Error al registrar pago manual:', error);
    return res.status(500).json({ success: false, message: 'Error al registrar pago manual', error: error.message });
  }
};

/**
 * PATCH /api/payments/admin/:id/status
 * Actualizar estado de cobro manualmente (PAID, CANCELLED, PENDING, OVERDUE)
 */
export const updatePaymentStatusAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const adminUserId = req.user?.id;

    if (!status) return res.status(400).json({ success: false, message: 'El estado es requerido.' });

    const payment = await prisma.payment.findUnique({
      where: { id },
      include: { house: true, resident: true },
    });

    if (!payment) return res.status(404).json({ success: false, message: 'Cobro no encontrado.' });

    const isPaid = status === 'PAID';
    const updated = await prisma.payment.update({
      where: { id },
      data: {
        status,
        notes: notes || payment.notes,
        ...(isPaid
          ? {
              paidAt: new Date(),
              confirmedByUserId: adminUserId,
              confirmedAt: new Date(),
            }
          : {}),
      },
      include: { house: true, resident: true },
    });

    await refreshHouseFinancialStatus(payment.houseId, payment.residentId);

    return res.json({
      success: true,
      message: `Cobro actualizado a ${status}.`,
      payment: updated,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar estado del pago', error: error.message });
  }
};

/**
 * POST /api/payments/wompi/create-3ds
 * Inicia la transacción de compra con 3DS usando la API de Wompi El Salvador y OAuth Bearer Token
 */
export const createWompi3DsTransaction = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const {
      paymentId,
      numeroTarjeta,
      cvv,
      mesVencimiento,
      anioVencimiento,
      nombre,
      apellido,
      email,
      ciudad,
      direccion,
      idPais,
      idRegion,
      codigoPostal,
      telefono,
    } = req.body;

    if (!numeroTarjeta || !cvv || !mesVencimiento || !anioVencimiento) {
      return res.status(400).json({
        success: false,
        message: 'Datos completos de la tarjeta de crédito son requeridos.',
      });
    }

    let existingPayment = null;
    if (paymentId && typeof paymentId === 'string' && !paymentId.startsWith('pay-')) {
      existingPayment = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: {
          resident: {
            select: {
              fullName: true,
              email: true,
              phone: true,
            },
          },
        },
      });
    }

    if (!existingPayment) {
      existingPayment = await prisma.payment.findFirst({
        where: { residentId: userId, status: 'PENDING' },
        include: {
          resident: {
            select: {
              fullName: true,
              email: true,
              phone: true,
            },
          },
        },
      });

      if (!existingPayment) {
        const defaultDueDate = new Date();
        defaultDueDate.setDate(defaultDueDate.getDate() + 7);

        existingPayment = await prisma.payment.create({
          data: {
            residentId: userId,
            concept: 'Cuota de Mantenimiento',
            amount: 85.0,
            currency: 'USD',
            dueDate: defaultDueDate,
            status: 'PENDING',
          },
          include: {
            resident: {
              select: {
                fullName: true,
                email: true,
                phone: true,
              },
            },
          },
        });
      }
    }

    if (existingPayment.status === 'PAID') {
      return res.status(400).json({ success: false, message: 'Este cobro ya ha sido pagado previamente.' });
    }

    const cleanCardNumber = String(numeroTarjeta).replace(/\s+/g, '');
    const cleanPhone = String(telefono || existingPayment.resident.phone || '70000000').replace(/[^\d]/g, '');
    const residentEmail = email || existingPayment.resident.email || 'notificaciones@zentary.app';
    const residentName = nombre || existingPayment.resident.fullName.split(' ')[0] || 'Residente';
    const residentLastName = apellido || existingPayment.resident.fullName.split(' ').slice(1).join(' ') || 'Zentary';

    const wompiPayload = {
      tarjetaCreditoDebido: {
        numeroTarjeta: cleanCardNumber,
        cvv: String(cvv),
        mesVencimiento: parseInt(String(mesVencimiento), 10),
        anioVencimiento: parseInt(String(anioVencimiento), 10),
      },
      monto: existingPayment.amount,
      nombreProducto: existingPayment.concept,
      nombreEnlacePago: existingPayment.concept,
      descripcion: existingPayment.concept,
      configuracion: {
        emailsNotificacion: residentEmail,
        urlWebhook: `${PUBLIC_APP_URL}/api/payments/webhook`,
        telefonosNotificacion: cleanPhone,
        notificarTransaccionCliente: true,
      },
      urlRedirect: `${PUBLIC_APP_URL}/api/payments/3ds-redirect?paymentId=${existingPayment.id}`,
      nombre: residentName,
      apellido: residentLastName,
      email: residentEmail,
      ciudad: ciudad || 'San Salvador',
      direccion: direccion || 'Residencial Zentary',
      idPais: idPais || 'SV',
      idRegion: idRegion || 'SV-SS',
      codigoPostal: codigoPostal || '01101',
      telefono: cleanPhone,
      datosAdicionales: {
        paymentId: existingPayment.id,
        residentId: existingPayment.residentId,
        concept: existingPayment.concept,
        nombreProducto: existingPayment.concept,
        descripcion: existingPayment.concept,
      },
    };

    console.log(`💳 [WOMPI 3DS SUBMIT] Invocando servicio Wompi 3DS para pago ${existingPayment.id} ($${existingPayment.amount})...`);

    let wompiResponseData: any = null;
    try {
      wompiResponseData = await createWompi3DsPurchase(wompiPayload);
    } catch (wompiErr: any) {
      console.error('❌ [WOMPI 3DS VALIDATION ERROR]', wompiErr.message);
      return res.status(400).json({
        success: false,
        message: `Error de Wompi: ${wompiErr.message}`,
      });
    }

    const transactionId = wompiResponseData.idTransaccion || `WOMPI-${Date.now()}`;
    const redirect3DsUrl = wompiResponseData.urlCompletarPago3Ds || `${PUBLIC_APP_URL}/api/payments/3ds-redirect?paymentId=${existingPayment.id}`;

    await prisma.payment.update({
      where: { id: existingPayment.id },
      data: {
        externalTransactionId: transactionId,
        paymentMethod: 'Tarjeta de Crédito / Débito (Wompi 3DS)',
        rawGatewayResponse: JSON.stringify(wompiResponseData),
      },
    });

    return res.json({
      success: true,
      message: 'Transacción Wompi 3DS iniciada exitosamente.',
      idTransaccion: transactionId,
      urlCompletarPago3Ds: redirect3DsUrl,
      monto: wompiResponseData.monto || existingPayment.amount,
      esReal: wompiResponseData.esReal ?? false,
    });
  } catch (error: any) {
    console.error('❌ [WOMPI 3DS CONTROLLER ERROR]', error);
    return res.status(500).json({ success: false, message: 'Error al procesar transacción Wompi 3DS', error: error.message });
  }
};

/**
 * GET /api/payments/3ds-redirect
 * URL de redirección invocada por Wompi al finalizar la autenticación 3DS
 */
export const render3DsRedirect = async (req: Request, res: Response) => {
  const { paymentId } = req.query;

  try {
    if (paymentId && typeof paymentId === 'string') {
      const updated = await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paymentMethod: 'Wompi 3DS',
        },
      });
      await refreshHouseFinancialStatus(updated.houseId, updated.residentId);
    }

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Zentary | Verificación de Pago</title>
  <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;600;700;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Outfit', sans-serif; }
    body { background: #0F172A; color: #F8FAFC; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; text-align: center; }
    .card { background: #1E293B; border: 1px solid rgba(255,255,255,0.1); border-radius: 28px; padding: 36px 24px; max-width: 400px; width: 100%; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5); }
    .icon { width: 72px; height: 72px; background: rgba(16, 185, 129, 0.15); border: 2px solid #10B981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px auto; color: #10B981; font-size: 36px; }
    h1 { font-size: 22px; font-weight: 800; color: #FFFFFF; margin-bottom: 8px; }
    p { font-size: 14px; color: #94A3B8; margin-bottom: 24px; line-height: 1.5; }
    .btn { display: inline-block; width: 100%; padding: 14px; background: linear-gradient(135deg, #2563EB, #1D4ED8); border: none; border-radius: 14px; color: #FFFFFF; font-size: 15px; font-weight: 700; text-decoration: none; cursor: pointer; }
  </style>
  <script>
    function returnToApp() {
      window.location.href = 'zentary://payments';
      setTimeout(function() {
        try { window.close(); } catch(e) {}
      }, 1000);
    }
    setTimeout(returnToApp, 2000);
  </script>
</head>
<body>
  <div class="card">
    <div class="icon">✓</div>
    <h1>¡Pago Procesado Con Éxito!</h1>
    <p>La autenticación Wompi 3DS fue completada correctamente. Tu estado de cuenta ha sido actualizado en Zentary.</p>
    <button onclick="returnToApp()" class="btn">Volver a la Aplicación</button>
  </div>
</body>
</html>`;

    return res.send(html);
  } catch (err: any) {
    return res.status(500).send(`<h2>Error en verificación 3DS: ${err.message}</h2>`);
  }
};

/**
 * POST /api/payments/webhook
 * Notificación asíncrona de Wompi cuando una transacción es aprobada
 */
export const handlePaymentWebhook = async (req: Request, res: Response) => {
  try {
    const webhookPayload = req.body;
    console.log('🔔 [WOMPI WEBHOOK RECEIVED]', JSON.stringify(webhookPayload));

    const idTransaccion = webhookPayload.idTransaccion || webhookPayload.id;
    const paymentId = webhookPayload.datosAdicionales?.paymentId || webhookPayload.paymentId;

    if (paymentId) {
      const updated = await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          externalTransactionId: idTransaccion || undefined,
          rawGatewayResponse: JSON.stringify(webhookPayload),
        },
      });
      await refreshHouseFinancialStatus(updated.houseId, updated.residentId);
      console.log(`✅ [WOMPI WEBHOOK SUCCESS] Pago ID ${paymentId} actualizado a PAID.`);
    } else if (idTransaccion) {
      const existing = await prisma.payment.findFirst({
        where: { externalTransactionId: idTransaccion },
      });
      if (existing) {
        const updated = await prisma.payment.update({
          where: { id: existing.id },
          data: {
            status: 'PAID',
            paidAt: new Date(),
            rawGatewayResponse: JSON.stringify(webhookPayload),
          },
        });
        await refreshHouseFinancialStatus(updated.houseId, updated.residentId);
        console.log(`✅ [WOMPI WEBHOOK SUCCESS] Pago ${existing.id} actualizado a PAID.`);
      }
    }

    return res.json({ success: true, message: 'Webhook procesado correctamente.' });
  } catch (error: any) {
    console.error('❌ [WOMPI WEBHOOK ERROR]', error);
    return res.status(500).json({ success: false, message: 'Error en webhook', error: error.message });
  }
};
