/**
 * Service for Wompi El Salvador 3DS API integration
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { prisma } from '../config/prisma.js';
import { decryptSecret } from '../utils/secretCipher.js';

const WOMPI_CLIENT_ID = process.env.WOMPI_CLIENT_ID;
const WOMPI_CLIENT_SECRET = process.env.WOMPI_CLIENT_SECRET;
const WOMPI_API_URL = process.env.WOMPI_API_URL || 'https://api.wompi.sv';
const WOMPI_TOKEN_URL = process.env.WOMPI_TOKEN_URL || 'https://id.wompi.sv/connect/token';

export interface WompiCredentials {
  clientId: string;
  clientSecret: string;
  source: 'tenant' | 'company';
}

/** Credenciales o pasarela no disponibles (los cobros nuevos responden 503) */
export class WompiUnavailableError extends Error {
  code = 'GATEWAY_UNAVAILABLE';
  constructor(message: string) {
    super(message);
  }
}

// Caché de tokens por clientId (nunca por tenant ni por secreto)
const tokenCache = new Map<string, { token: string; expiresAt: number }>();

export const invalidateWompiTokenCache = (clientId?: string) => {
  if (clientId) tokenCache.delete(clientId);
  else tokenCache.clear();
};

export const getCompanyWompiCredentials = (): WompiCredentials | null => {
  if (!WOMPI_CLIENT_ID || !WOMPI_CLIENT_SECRET) return null;
  return { clientId: WOMPI_CLIENT_ID, clientSecret: WOMPI_CLIENT_SECRET, source: 'company' };
};

/**
 * Regla pura de resolución: fila del tenant (si está activa, o si es verificación de una
 * transacción existente) y si no, la empresa. Fila indescifrable o clave ausente: fallo cerrado.
 */
export const pickWompiCredentials = (
  row: { tenantId: string; clientId: string; clientSecretEnc: string; enabled: boolean } | null,
  opts: { forNewCharge?: boolean } = {},
  company: WompiCredentials | null = getCompanyWompiCredentials(),
  decrypt: (payload: string, aad: string) => string = decryptSecret
): WompiCredentials => {
  if (row && (row.enabled || !opts.forNewCharge)) {
    try {
      return { clientId: row.clientId, clientSecret: decrypt(row.clientSecretEnc, row.tenantId), source: 'tenant' };
    } catch {
      throw new WompiUnavailableError('Las credenciales de la pasarela de la residencial no están disponibles.');
    }
  }
  if (!company) throw new WompiUnavailableError('Credenciales de Wompi no configuradas en el servidor.');
  return company;
};

export const getWompiCredentials = async (
  tenantId?: string | null,
  opts: { forNewCharge?: boolean } = {}
): Promise<WompiCredentials> => {
  const row = tenantId ? await prisma.tenantPaymentGateway.findUnique({ where: { tenantId } }) : null;
  return pickWompiCredentials(row, opts);
};

/**
 * Obtain Wompi OAuth 2.0 Access Token using client_credentials grant
 */
export const getWompiAccessToken = async (creds?: WompiCredentials): Promise<string> => {
  const credentials = creds ?? getCompanyWompiCredentials();
  if (!credentials) {
    throw new WompiUnavailableError('Credenciales de Wompi no configuradas en el servidor.');
  }

  const now = Date.now();
  // Return cached token if valid for at least another 60 seconds
  const cached = tokenCache.get(credentials.clientId);
  if (cached && cached.expiresAt > now + 60000) {
    return cached.token;
  }

  console.log(`🔐 [WOMPI OAUTH] Solicitando token de acceso a ${WOMPI_TOKEN_URL}...`);

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', credentials.clientId);
    params.append('client_secret', credentials.clientSecret);
    params.append('audience', 'wompi_api');

    const res = await fetch(WOMPI_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    const data: any = await res.json();

    if (!res.ok || !data.access_token) {
      // Solo el estado HTTP: la respuesta puede referirse a las credenciales
      console.error('❌ Error al obtener token de Wompi: HTTP', res.status);
      throw new Error('Fallo en autenticación Wompi OAuth');
    }

    tokenCache.set(credentials.clientId, {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
    });

    console.log(`✅ [WOMPI OAUTH SUCCESS] Token de acceso obtenido. Expira en ${data.expires_in || 3600} segundos.`);
    return data.access_token as string;
  } catch (err: any) {
    console.error('❌ [WOMPI TOKEN EXCEPTION]', err.message);
    throw err;
  }
};

/**
 * Execute a 3DS Purchase Transaction via Wompi API
 */
export const createWompi3DsPurchase = async (payload: any, tenantId?: string | null): Promise<any> => {
  const credentials = await getWompiCredentials(tenantId, { forNewCharge: true });
  const accessToken = await getWompiAccessToken(credentials);

  console.log(`💳 [WOMPI 3DS API] Invocando POST ${WOMPI_API_URL}/TransaccionCompra/3DS para el monto de $${payload.monto}...`);

  const response = await fetch(`${WOMPI_API_URL}/TransaccionCompra/3DS`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify(payload),
  });

  const data: any = await response.json();

  if (!response.ok || (data.mensajes && data.mensajes.length > 0) || (!data.idTransaccion && !data.urlCompletarPago3Ds)) {
    console.error('⚠️ Respuesta de error Wompi 3DS:', response.status, JSON.stringify({ mensajes: data.mensajes, mensaje: data.mensaje, error: data.error }));
    const errorMessage = Array.isArray(data.mensajes) && data.mensajes.length > 0
      ? data.mensajes.join('. ')
      : (data.mensaje || data.error || 'Error al procesar la compra 3DS con Wompi');
    throw new Error(errorMessage);
  }

  return data;
};

/**
 * Busca la residencial dueña de una transacción (cobro o reserva) por su id en Wompi
 */
export const findTenantIdByTransaction = async (idTransaccion: string): Promise<string | null> => {
  const payment = await prisma.payment.findFirst({
    where: { externalTransactionId: idTransaccion },
    select: { tenantId: true },
  });
  if (payment) return payment.tenantId ?? null;
  const reservation = await prisma.amenityReservation.findFirst({
    where: { paymentReference: idTransaccion },
    select: { tenantId: true },
  });
  return reservation?.tenantId ?? null;
};

const fetchWompiTransaction = async (idTransaccion: string, credentials: WompiCredentials): Promise<Response> => {
  const accessToken = await getWompiAccessToken(credentials);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    return await fetch(`${WOMPI_API_URL}/TransaccionCompra/${encodeURIComponent(idTransaccion)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Consulta una transacción de compra en Wompi por su id (fuente de verdad del estado del pago)
 */
export const verifyWompiTransaction = async (
  idTransaccion: string,
  tenantId?: string | null
): Promise<{ approved: boolean; monto: number; idTransaccion: string; raw: any }> => {
  const resolvedTenantId = tenantId ?? (await findTenantIdByTransaction(idTransaccion));
  const credentials = await getWompiCredentials(resolvedTenantId, { forNewCharge: false });

  let response = await fetchWompiTransaction(idTransaccion, credentials);

  // Transacciones creadas antes de configurar credenciales propias: reintento con las de la empresa
  if (credentials.source === 'tenant' && (response.status === 404 || response.status === 403)) {
    const company = getCompanyWompiCredentials();
    if (company) response = await fetchWompiTransaction(idTransaccion, company);
  }

  const data: any = await response.json();

  if (!response.ok) {
    console.error('⚠️ Respuesta de error Wompi al consultar transacción:', response.status);
    throw new Error('No se pudo consultar la transacción en Wompi.');
  }

  return {
    approved: data.esAprobada === true,
    monto: Number(data.monto),
    idTransaccion: String(data.idTransaccion ?? ''),
    raw: data,
  };
};

/**
 * Valida el encabezado wompi_hash del webhook: HMAC-SHA256 (hex) del cuerpo crudo con el client secret
 * (por defecto el de la empresa; se puede pasar el de una residencial)
 */
export const isValidWompiWebhookHash = (
  rawBody: Buffer | undefined,
  hash: unknown,
  secret: string | undefined = WOMPI_CLIENT_SECRET
): boolean => {
  if (!secret || !rawBody || typeof hash !== 'string') return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = hash.trim().toLowerCase();
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
};
