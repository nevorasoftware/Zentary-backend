import crypto from 'crypto';
import QRCode from 'qrcode';
import { prisma } from '../config/prisma.js';

const MASTER_FALLBACK_SECRET = process.env.QR_HMAC_SECRET || 'zentary-production-cryptographic-qr-key-2026';

export interface DynamicQrPayload {
  v: number;       // Format version (2 for Zentary 2.0)
  tid: string;     // Tenant ID
  vid: string;     // Visit ID
  rid: string;     // Resident ID
  iat: number;     // Issued At (unix timestamp in seconds)
  exp: number;     // Expires At (unix timestamp in seconds)
  non: string;     // Cryptographic nonce (prevent replay)
}

export interface DynamicQrResult {
  token: string;
  expiresAt: Date;
  remainingSeconds: number;
  qrImageDataUrl: string;
  payload: DynamicQrPayload;
}

export interface VerifyQrResult {
  valid: boolean;
  code?: string;
  message?: string;
  visitId?: string;
  tenantId?: string;
  tokenRecord?: any;
  payload?: DynamicQrPayload;
}

/**
 * Resolves the secret HMAC key for a given tenant
 */
export async function getTenantHmacSecret(tenantId: string): Promise<string> {
  try {
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { hmacSecretKey: true },
    });

    if (settings?.hmacSecretKey) {
      return settings.hmacSecretKey;
    }
  } catch (error) {
    console.warn(`[QR_SERVICE] Could not retrieve tenant settings for ${tenantId}:`, error);
  }
  return MASTER_FALLBACK_SECRET;
}

/**
 * Generates a signed, dynamic, rotating QR token for a visitor pass (Zentary 2.0)
 */
export async function generateDynamicQrToken(
  visitId: string,
  tenantId: string,
  residentId?: string,
  customExpirationMinutes?: number
): Promise<DynamicQrResult> {
  const secretKey = await getTenantHmacSecret(tenantId);

  // Determine expiration window (default 15 minutes as per Spec Principle 13 & 14)
  let expirationMinutes = customExpirationMinutes || 15;
  if (!customExpirationMinutes) {
    const settings = await prisma.tenantSettings.findUnique({
      where: { tenantId },
      select: { qrExpirationMinutes: true },
    });
    if (settings?.qrExpirationMinutes) {
      expirationMinutes = settings.qrExpirationMinutes;
    }
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const expSec = nowSec + expirationMinutes * 60;
  const nonce = crypto.randomBytes(4).toString('hex');

  const payload: DynamicQrPayload = {
    v: 2,
    tid: tenantId,
    vid: visitId,
    rid: residentId || 'unknown',
    iat: nowSec,
    exp: expSec,
    non: nonce,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secretKey).update(payloadB64).digest('base64url');

  // Token format: ZNT2.<base64url_payload>.<base64url_hmac_signature>
  const tokenString = `ZNT2.${payloadB64}.${signature}`;
  const expiresAtDate = new Date(expSec * 1000);

  // Invalidate any old tokens for this visit
  await prisma.visitToken.updateMany({
    where: { visitId, isRevoked: false },
    data: { isRevoked: true },
  });

  // Store active token record in database for revocation tracking and audit trail
  await prisma.visitToken.create({
    data: {
      visitId,
      token: tokenString,
      expiresAt: expiresAtDate,
    },
  });

  // Generate high-resolution QR Data URL for display on mobile screens and tablets
  const qrImageDataUrl = await QRCode.toDataURL(tokenString, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: {
      dark: '#0f172a',
      light: '#ffffff',
    },
  });

  return {
    token: tokenString,
    expiresAt: expiresAtDate,
    remainingSeconds: expSec - nowSec,
    qrImageDataUrl,
    payload,
  };
}

/**
 * Validates a dynamic QR token presented at gate / guard scanner
 */
export async function verifyDynamicQrToken(
  tokenString: string,
  guardTenantId?: string
): Promise<VerifyQrResult> {
  if (!tokenString || typeof tokenString !== 'string') {
    return {
      valid: false,
      code: 'MISSING_TOKEN',
      message: 'Token de código QR no proporcionado.',
    };
  }

  const trimmedToken = tokenString.trim();

  // Mode A: Zentary 2.0 Cryptographic Token (ZNT2.payload.signature)
  if (trimmedToken.startsWith('ZNT2.')) {
    const parts = trimmedToken.split('.');
    if (parts.length !== 3) {
      return {
        valid: false,
        code: 'MALFORMED_TOKEN',
        message: 'Estructura de código QR inválida.',
      };
    }

    const [, payloadB64, providedSignature] = parts;

    let payload: DynamicQrPayload;
    try {
      const decodedJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
      payload = JSON.parse(decodedJson);
    } catch {
      return {
        valid: false,
        code: 'INVALID_PAYLOAD',
        message: 'No fue posible decodificar el contenido del código QR.',
      };
    }

    // Tenant Isolation Check (Principio 3 y 45)
    if (guardTenantId && payload.tid && payload.tid !== guardTenantId) {
      return {
        valid: false,
        code: 'TENANT_MISMATCH',
        message: '❌ ACCESO DENEGADO: Este pase QR pertenece a otra residencial.',
        tenantId: payload.tid,
      };
    }

    // Verify HMAC-SHA256 signature
    const secretKey = await getTenantHmacSecret(payload.tid);
    const expectedSignature = crypto.createHmac('sha256', secretKey).update(payloadB64).digest('base64url');

    const providedBuf = Buffer.from(providedSignature);
    const expectedBuf = Buffer.from(expectedSignature);

    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      return {
        valid: false,
        code: 'INVALID_SIGNATURE',
        message: '❌ Criptofirma inválida. El código QR ha sido adulterado o es falso.',
      };
    }

    // Check expiration timestamp
    const nowSec = Math.floor(Date.now() / 1000);
    if (payload.exp < nowSec) {
      return {
        valid: false,
        code: 'EXPIRED_TOKEN',
        message: '⏱️ Código QR expirado. El código rota dinámicamente cada 15 minutos.',
        visitId: payload.vid,
        tenantId: payload.tid,
      };
    }

    // Check database status of the token record
    const tokenRecord = await prisma.visitToken.findUnique({
      where: { token: trimmedToken },
      include: {
        visit: {
          include: {
            resident: {
              select: {
                fullName: true,
                phone: true,
                tenant: { select: { name: true } },
                house: { select: { unitNumber: true, block: true } },
                property: { select: { unitNumber: true, block: true } },
              },
            },
            house: {
              select: { unitNumber: true, block: true },
            },
          },
        },
      },
    });

    if (tokenRecord) {
      if (tokenRecord.isRevoked) {
        return {
          valid: false,
          code: 'REVOKED_TOKEN',
          message: '❌ Este código QR ya fue utilizado o ha sido revocado.',
          visitId: payload.vid,
          tenantId: payload.tid,
        };
      }
    }

    return {
      valid: true,
      visitId: payload.vid,
      tenantId: payload.tid,
      payload,
      tokenRecord,
    };
  }

  // Mode B: Legacy compatibility token (e.g. ACCESS-XXXX)
  const tokenRecord = await prisma.visitToken.findUnique({
    where: { token: trimmedToken },
    include: {
      visit: {
        include: {
          resident: {
            select: {
              fullName: true,
              phone: true,
              tenant: { select: { name: true } },
              house: { select: { unitNumber: true, block: true } },
              property: { select: { unitNumber: true, block: true } },
            },
          },
          house: {
            select: { unitNumber: true, block: true },
          },
        },
      },
    },
  });

  if (!tokenRecord) {
    return {
      valid: false,
      code: 'TOKEN_NOT_FOUND',
      message: '❌ Código de acceso no encontrado en el sistema.',
    };
  }

  if (tokenRecord.isRevoked) {
    return {
      valid: false,
      code: 'REVOKED_TOKEN',
      message: '❌ Este código de acceso ya fue utilizado o revocado.',
    };
  }

  if (tokenRecord.expiresAt < new Date()) {
    return {
      valid: false,
      code: 'EXPIRED_TOKEN',
      message: '⏱️ Código de acceso expirado.',
    };
  }

  if (guardTenantId && tokenRecord.visit.tenantId && tokenRecord.visit.tenantId !== guardTenantId) {
    return {
      valid: false,
      code: 'TENANT_MISMATCH',
      message: '❌ ACCESO DENEGADO: Este pase pertenece a otra residencial.',
    };
  }

  return {
    valid: true,
    visitId: tokenRecord.visitId,
    tenantId: tokenRecord.visit.tenantId || undefined,
    tokenRecord,
  };
}
