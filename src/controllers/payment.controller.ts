import { Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { createWompi3DsPurchase } from '../services/wompi.service.js';

const PUBLIC_APP_URL = process.env.PUBLIC_APP_URL || 'https://zentary-backend-production.up.railway.app';

/**
 * GET /api/payments
 * Obtener lista de cobros/pagos del usuario autenticado desde la base de datos PostgreSQL.
 * Si el usuario no posee cobros en la BD, se autogenera un cobro inicial.
 */
export const getPayments = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    let payments = await prisma.payment.findMany({
      where: { residentId: userId },
      orderBy: { createdAt: 'desc' },
      include: {
        property: {
          select: {
            unitNumber: true,
            block: true,
          },
        },
      },
    });

    // Si el residente aún no posee cobros en BD, crear el cobro inicial en PostgreSQL
    if (payments.length === 0) {
      const defaultDueDate = new Date();
      defaultDueDate.setDate(defaultDueDate.getDate() + 7);

      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { property: true },
      });

      const newPayment = await prisma.payment.create({
        data: {
          residentId: userId,
          propertyId: user?.property?.id || null,
          concept: 'Cuota de Mantenimiento Agosto 2026',
          amount: 85.0,
          currency: 'USD',
          dueDate: defaultDueDate,
          status: 'PENDING',
        },
        include: {
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
 * GET /api/payments/admin/all
 * Obtener lista completa de pagos para el portal administrativo desde PostgreSQL
 */
export const getAllPaymentsAdmin = async (_req: AuthRequest, res: Response) => {
  try {
    const payments = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        resident: {
          select: {
            fullName: true,
            email: true,
            phone: true,
            property: { select: { unitNumber: true, block: true } },
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
 * POST /api/payments / POST /api/payments/admin/create-charge
 * Crear una nueva solicitud de cobro.
 * Si se especifica targetResidentId, se genera para ese residente.
 * Si NO se especifica, se emite MASIVAMENTE para TODOS los residentes registrados en la BD PostgreSQL.
 */
export const createPaymentRequest = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { concept, amount, currency, dueDate, propertyId, targetResidentId } = req.body;

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

    // 1. Cobro dirigido a un residente específico
    if (targetResidentId && targetResidentId !== 'ALL') {
      const payment = await prisma.payment.create({
        data: {
          residentId: targetResidentId,
          propertyId: propertyId || null,
          concept,
          amount: parseFloat(amount),
          currency: currency || 'USD',
          dueDate: parsedDueDate,
          status: 'PENDING',
        },
      });

      console.log(`✅ [PAYMENT CREATED] Cobro creado en BD PostgreSQL para el residente ID ${targetResidentId}.`);
      return res.status(201).json({ success: true, message: 'Cobro creado exitosamente para el residente.', payment });
    }

    // 2. Cobro Masivo (Emitir a todos los residentes de la residencial)
    const residents = await prisma.user.findMany({
      where: { role: 'RESIDENT' },
      include: { property: true },
    });

    if (residents.length === 0) {
      const payment = await prisma.payment.create({
        data: {
          residentId: userId || 'admin-fallback',
          concept,
          amount: parseFloat(amount),
          currency: currency || 'USD',
          dueDate: parsedDueDate,
          status: 'PENDING',
        },
      });
      return res.status(201).json({ success: true, message: 'Cobro registrado en BD PostgreSQL', payment });
    }

    const createdPayments = await Promise.all(
      residents.map((r) =>
        prisma.payment.create({
          data: {
            residentId: r.id,
            propertyId: r.property?.id || null,
            concept,
            amount: parseFloat(amount),
            currency: currency || 'USD',
            dueDate: parsedDueDate,
            status: 'PENDING',
          },
        })
      )
    );

    console.log(`✅ [MASS BILLING SUCCESS] Se emitieron ${createdPayments.length} cobros en PostgreSQL para todos los residentes.`);

    return res.status(201).json({
      success: true,
      message: `Cobro masivo emitido exitosamente a ${createdPayments.length} residentes en la base de datos.`,
      count: createdPayments.length,
      payments: createdPayments,
    });
  } catch (error: any) {
    console.error('❌ Error al crear cobro:', error);
    return res.status(500).json({ success: false, message: 'Error al crear la solicitud de pago', error: error.message });
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

    // Buscar o garantizar un registro real de pago en la base de datos PostgreSQL
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

    // Si no existía o se usó un id de demostración ('pay-001'), asociar a un pago real pendiente del residente en BD
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
            concept: 'Cuota de Mantenimiento Agosto 2026',
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

    // Formatear payload de Wompi 3DS
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

    // Actualizar registro en base de datos PostgreSQL
    await prisma.payment.update({
      where: { id: existingPayment.id },
      data: {
        externalTransactionId: transactionId,
        paymentMethod: 'Tarjeta de Crédito / Débito (Wompi 3DS)',
        rawGatewayResponse: JSON.stringify(wompiResponseData),
      },
    });

    console.log(`✅ [WOMPI 3DS CREATED] Transacción iniciada en BD. ID: ${transactionId}`);

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
 * URL de redirección invocada por Wompi al finalizar la autenticación 3DS en el navegador
 */
export const render3DsRedirect = async (req: Request, res: Response) => {
  const { paymentId } = req.query;

  try {
    if (paymentId && typeof paymentId === 'string') {
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          paymentMethod: 'Wompi 3DS',
        },
      });
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
    // Auto-redireccionar a la app Zentary en 2 segundos
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
 * Recibe la notificación asíncrona enviada por Wompi cuando la transacción es aprobada
 */
export const handlePaymentWebhook = async (req: Request, res: Response) => {
  try {
    const webhookPayload = req.body;
    console.log('🔔 [WOMPI WEBHOOK RECEIVED]', JSON.stringify(webhookPayload));

    const idTransaccion = webhookPayload.idTransaccion || webhookPayload.id;
    const paymentId = webhookPayload.datosAdicionales?.paymentId || webhookPayload.paymentId;

    if (paymentId) {
      await prisma.payment.update({
        where: { id: paymentId },
        data: {
          status: 'PAID',
          paidAt: new Date(),
          externalTransactionId: idTransaccion || undefined,
          rawGatewayResponse: JSON.stringify(webhookPayload),
        },
      });
      console.log(`✅ [WOMPI WEBHOOK SUCCESS] Pago ID ${paymentId} actualizado a PAID en PostgreSQL.`);
    } else if (idTransaccion) {
      const existing = await prisma.payment.findFirst({
        where: { externalTransactionId: idTransaccion },
      });
      if (existing) {
        await prisma.payment.update({
          where: { id: existing.id },
          data: {
            status: 'PAID',
            paidAt: new Date(),
            rawGatewayResponse: JSON.stringify(webhookPayload),
          },
        });
        console.log(`✅ [WOMPI WEBHOOK SUCCESS] Pago ${existing.id} (TXN: ${idTransaccion}) actualizado a PAID en PostgreSQL.`);
      }
    }

    return res.json({ success: true, message: 'Webhook procesado correctamente.' });
  } catch (error: any) {
    console.error('❌ [WOMPI WEBHOOK ERROR]', error);
    return res.status(500).json({ success: false, message: 'Error en webhook', error: error.message });
  }
};
