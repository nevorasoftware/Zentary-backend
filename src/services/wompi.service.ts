/**
 * Service for Wompi El Salvador 3DS API integration
 */

import { createHmac, timingSafeEqual } from 'crypto';

const WOMPI_CLIENT_ID = process.env.WOMPI_CLIENT_ID;
const WOMPI_CLIENT_SECRET = process.env.WOMPI_CLIENT_SECRET;
const WOMPI_API_URL = process.env.WOMPI_API_URL || 'https://api.wompi.sv';
const WOMPI_TOKEN_URL = process.env.WOMPI_TOKEN_URL || 'https://id.wompi.sv/connect/token';

let cachedAccessToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * Obtain Wompi OAuth 2.0 Access Token using client_credentials grant
 */
export const getWompiAccessToken = async (): Promise<string> => {
  if (!WOMPI_CLIENT_ID || !WOMPI_CLIENT_SECRET) {
    throw new Error('Credenciales de Wompi no configuradas en el servidor.');
  }

  const now = Date.now();
  // Return cached token if valid for at least another 60 seconds
  if (cachedAccessToken && tokenExpiresAt > now + 60000) {
    return cachedAccessToken;
  }

  console.log(`🔐 [WOMPI OAUTH] Solicitando token de acceso a ${WOMPI_TOKEN_URL}...`);

  try {
    const params = new URLSearchParams();
    params.append('grant_type', 'client_credentials');
    params.append('client_id', WOMPI_CLIENT_ID);
    params.append('client_secret', WOMPI_CLIENT_SECRET);
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
      console.error('❌ Error al obtener token de Wompi:', res.status, data.error);
      throw new Error(data.error_description || data.error || 'Fallo en autenticación Wompi OAuth');
    }

    cachedAccessToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in || 3600) * 1000;

    console.log(`✅ [WOMPI OAUTH SUCCESS] Token de acceso obtenido. Expira en ${data.expires_in || 3600} segundos.`);
    return cachedAccessToken as string;
  } catch (err: any) {
    console.error('❌ [WOMPI TOKEN EXCEPTION]', err.message);
    throw err;
  }
};

/**
 * Execute a 3DS Purchase Transaction via Wompi API
 */
export const createWompi3DsPurchase = async (payload: any): Promise<any> => {
  const accessToken = await getWompiAccessToken();

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
 * Consulta una transacción de compra en Wompi por su id (fuente de verdad del estado del pago)
 */
export const verifyWompiTransaction = async (
  idTransaccion: string
): Promise<{ approved: boolean; monto: number; idTransaccion: string; raw: any }> => {
  const accessToken = await getWompiAccessToken();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${WOMPI_API_URL}/TransaccionCompra/${encodeURIComponent(idTransaccion)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });

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
  } finally {
    clearTimeout(timer);
  }
};

/**
 * Valida el encabezado wompi_hash del webhook: HMAC-SHA256 (hex) del cuerpo crudo con el client secret
 */
export const isValidWompiWebhookHash = (rawBody: Buffer | undefined, hash: unknown): boolean => {
  if (!WOMPI_CLIENT_SECRET || !rawBody || typeof hash !== 'string') return false;
  const expected = createHmac('sha256', WOMPI_CLIENT_SECRET).update(rawBody).digest('hex');
  const received = hash.trim().toLowerCase();
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  return a.length === b.length && timingSafeEqual(a, b);
};
