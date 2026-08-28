/**
 * Service for Wompi El Salvador 3DS API integration
 */

const WOMPI_CLIENT_ID = process.env.WOMPI_CLIENT_ID || '679be73b-141f-4e65-8879-4b60e2481494';
const WOMPI_CLIENT_SECRET = process.env.WOMPI_CLIENT_SECRET || '7e390fe6-ce11-4350-8b80-6806d0a61a39';
const WOMPI_API_URL = process.env.WOMPI_API_URL || 'https://api.wompi.sv';
const WOMPI_TOKEN_URL = process.env.WOMPI_TOKEN_URL || 'https://id.wompi.sv/connect/token';

let cachedAccessToken: string | null = null;
let tokenExpiresAt: number = 0;

/**
 * Obtain Wompi OAuth 2.0 Access Token using client_credentials grant
 */
export const getWompiAccessToken = async (): Promise<string> => {
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
      console.error('❌ Error al obtener token de Wompi:', data);
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
    console.error('⚠️ Respuesta de error Wompi 3DS:', JSON.stringify(data));
    const errorMessage = Array.isArray(data.mensajes) && data.mensajes.length > 0
      ? data.mensajes.join('. ')
      : (data.mensaje || data.error || 'Error al procesar la compra 3DS con Wompi');
    throw new Error(errorMessage);
  }

  return data;
};
