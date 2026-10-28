import { Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { logAuditEvent } from '../services/audit.service.js';
import { decryptSecret, encryptSecret, getEncryptionKey } from '../utils/secretCipher.js';
import { getWompiAccessToken, invalidateWompiTokenCache } from '../services/wompi.service.js';

export const gatewayBodySchema = z.object({
  clientId: z.string().trim().min(1).max(200).regex(/^\S+$/),
  clientSecret: z.string().min(8).max(500),
  enabled: z.boolean(),
});

export const testBodySchema = z.object({
  clientId: z.string().trim().min(1).max(200).regex(/^\S+$/),
  clientSecret: z.string().min(8).max(500),
});

const keyMissing = (res: Response) =>
  res.status(503).json({
    success: false,
    code: 'ENCRYPTION_KEY_MISSING',
    message: 'El almacenamiento de credenciales no está disponible por el momento.',
  });

const tenantRequired = (res: Response) =>
  res.status(400).json({ success: false, code: 'TENANT_REQUIRED', message: 'Identificador de residencial requerido.' });

/** Vista pública de la configuración: nunca incluye el secreto, ni cifrado */
export const toGatewayView = (
  row: { clientId: string; enabled: boolean; lastTestAt: Date | null; lastTestOk: boolean | null } | null,
  companyClientId?: string
) =>
  row
    ? {
        source: 'tenant' as const,
        clientId: row.clientId,
        enabled: row.enabled,
        hasSecret: true,
        lastTestAt: row.lastTestAt,
        lastTestOk: row.lastTestOk,
      }
    : {
        source: 'company' as const,
        clientId: companyClientId ?? null,
        enabled: true,
        hasSecret: !!companyClientId,
        lastTestAt: null,
        lastTestOk: null,
      };

// GET /api/tenants/current/payment-gateway
export const getPaymentGateway = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return tenantRequired(res);

    const row = await prisma.tenantPaymentGateway.findUnique({
      where: { tenantId },
      select: { clientId: true, enabled: true, lastTestAt: true, lastTestOk: true },
    });
    return res.json({ success: true, gateway: toGatewayView(row) });
  } catch (error: any) {
    console.error('getPaymentGateway:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// PUT /api/tenants/current/payment-gateway (SUPER_ADMIN)
export const savePaymentGateway = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return tenantRequired(res);

    const key = getEncryptionKey();
    if (!key) return keyMissing(res);

    const parsed = gatewayBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, message: 'Datos de la pasarela no válidos.' });
    }
    const { clientId, clientSecret, enabled } = parsed.data;

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) return res.status(404).json({ success: false, message: 'Residencial no encontrada.' });

    const previous = await prisma.tenantPaymentGateway.findUnique({ where: { tenantId }, select: { clientId: true } });
    const clientSecretEnc = encryptSecret(clientSecret, tenantId, key);

    const row = await prisma.tenantPaymentGateway.upsert({
      where: { tenantId },
      create: { tenantId, clientId, clientSecretEnc, enabled, updatedByUserId: req.user?.id },
      update: { clientId, clientSecretEnc, enabled, updatedByUserId: req.user?.id, lastTestAt: null, lastTestOk: null },
      select: { clientId: true, enabled: true, lastTestAt: true, lastTestOk: true },
    });

    invalidateWompiTokenCache(previous?.clientId);
    invalidateWompiTokenCache(clientId);

    // Auditoría: solo clientId y enabled, nunca el secreto
    await logAuditEvent({
      tenantId,
      userId: req.user?.id,
      action: 'UPDATE_PAYMENT_GATEWAY',
      entity: 'TenantPaymentGateway',
      entityId: tenantId,
      details: { clientId, enabled },
      ipAddress: req.ip,
    });

    return res.json({ success: true, gateway: toGatewayView(row) });
  } catch (error: any) {
    console.error('savePaymentGateway:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// DELETE /api/tenants/current/payment-gateway (SUPER_ADMIN)
export const deletePaymentGateway = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return tenantRequired(res);

    const previous = await prisma.tenantPaymentGateway.findUnique({ where: { tenantId }, select: { clientId: true } });
    if (previous) {
      await prisma.tenantPaymentGateway.delete({ where: { tenantId } });
      invalidateWompiTokenCache(previous.clientId);
    }

    await logAuditEvent({
      tenantId,
      userId: req.user?.id,
      action: 'DELETE_PAYMENT_GATEWAY',
      entity: 'TenantPaymentGateway',
      entityId: tenantId,
      details: previous ? { clientId: previous.clientId } : undefined,
      ipAddress: req.ip,
    });

    return res.json({ success: true, gateway: toGatewayView(null) });
  } catch (error: any) {
    console.error('deletePaymentGateway:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};

// POST /api/tenants/current/payment-gateway/test (SUPER_ADMIN)
export const testPaymentGateway = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) return tenantRequired(res);

    const key = getEncryptionKey();
    if (!key) return keyMissing(res);

    let clientId: string;
    let clientSecret: string;
    let stored = false;

    const hasBody = req.body && (req.body.clientId !== undefined || req.body.clientSecret !== undefined);
    if (hasBody) {
      const parsed = testBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: 'Datos de la pasarela no válidos.' });
      }
      clientId = parsed.data.clientId;
      clientSecret = parsed.data.clientSecret;
    } else {
      const row = await prisma.tenantPaymentGateway.findUnique({ where: { tenantId } });
      if (!row) {
        return res.status(404).json({ success: false, message: 'La residencial no tiene credenciales propias.' });
      }
      try {
        clientSecret = decryptSecret(row.clientSecretEnc, tenantId, key);
      } catch {
        return res.json({ success: true, ok: false });
      }
      clientId = row.clientId;
      stored = true;
    }

    // Evita reutilizar un token en caché: la prueba debe validar las credenciales
    invalidateWompiTokenCache(clientId);
    let ok = false;
    try {
      await getWompiAccessToken({ clientId, clientSecret, source: 'tenant' });
      ok = true;
    } catch {
      ok = false;
    }

    if (stored) {
      await prisma.tenantPaymentGateway.updateMany({
        where: { tenantId },
        data: { lastTestAt: new Date(), lastTestOk: ok },
      });
    }

    return res.json({ success: true, ok });
  } catch (error: any) {
    console.error('testPaymentGateway:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error interno del servidor.' });
  }
};
