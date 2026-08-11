import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';

export const getPayments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const payments = await prisma.payment.findMany({
      where: { residentId: userId },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, payments });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener la lista de pagos', error: error.message });
  }
};

export const createPaymentRequest = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { concept, amount, currency, dueDate, propertyId } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const payment = await prisma.payment.create({
      data: {
        residentId: userId,
        propertyId: propertyId || null,
        concept,
        amount: parseFloat(amount),
        currency: currency || 'USD',
        dueDate: new Date(dueDate),
        status: 'PENDING',
      },
    });

    return res.status(201).json({ success: true, message: 'Registro de cobro/pago creado', payment });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al crear la solicitud de pago', error: error.message });
  }
};

export const processPaymentGateway = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { paymentId, paymentMethod, paymentGatewayToken } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const existingPayment = await prisma.payment.findUnique({ where: { id: paymentId } });
    if (!existingPayment) {
      return res.status(404).json({ success: false, message: 'Registro de pago no encontrado.' });
    }

    // Placeholder integration point for external Payment API
    const simulatedTransactionId = `TXN-${Date.now()}-${Math.floor(Math.random() * 100000)}`;

    const updatedPayment = await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
        paymentMethod: paymentMethod || 'CREDIT_CARD',
        externalTransactionId: simulatedTransactionId,
        rawGatewayResponse: JSON.stringify({
          gatewayToken: paymentGatewayToken || 'simulated_token',
          processedAt: new Date().toISOString(),
          note: 'Ready for client custom API webhook payload integration',
        }),
      },
    });

    return res.json({
      success: true,
      message: 'Pago procesado exitosamente.',
      payment: updatedPayment,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al procesar la transacción de pago', error: error.message });
  }
};

export const handlePaymentWebhook = async (req: Request, res: Response) => {
  try {
    const webhookPayload = req.body;
    console.log('--- RECEIVED PAYMENT WEBHOOK ---', webhookPayload);

    // Dynamic handle for external provider callbacks
    return res.json({ received: true });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error en webhook', error: error.message });
  }
};
