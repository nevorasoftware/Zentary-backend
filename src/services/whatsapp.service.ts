import dotenv from 'dotenv';
dotenv.config();

const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1354118731108141';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || 'EAAcQvTQZCZCroBSX9RCREv0kTDNZBybhezyuKlhIaVKEJliVgOQOdDcnpRn6cDDhtXohG9TK4EX5lyy9b6nsN7nJsrCmJZBjTKBziMFzT2dwJS242p7FBCSGiVv7AMb4jaciJHkOZAc8TzdmLviiDvXetkuhydvMTrv3ohwDjEUhHjd3Jdj6UP5aCiAiZBdp3HeAZDZD';

/**
 * Normalizes phone number to international E.164 format without '+'
 * Default country code for El Salvador: 503
 */
export const normalizePhoneNumber = (phone: string): string => {
  let cleaned = phone.replace(/\D/g, ''); // strip non-numeric characters
  if (!cleaned) return '';

  // If number length is 8 digits (e.g. 70000000), prepend country code 503
  if (cleaned.length === 8) {
    cleaned = `503${cleaned}`;
  }
  return cleaned;
};

/**
 * Sends automated WhatsApp text message via Meta Cloud API
 */
export const sendWhatsAppMessage = async (toPhone: string, messageText: string): Promise<{ success: boolean; data?: any; error?: string }> => {
  try {
    const formattedPhone = normalizePhoneNumber(toPhone);
    if (!formattedPhone) {
      console.warn('⚠️ WhatsApp notification skipped: invalid phone number provided:', toPhone);
      return { success: false, error: 'Número de teléfono inválido' };
    }

    const endpoint = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
    
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'text',
      text: {
        preview_url: true,
        body: messageText,
      },
    };

    console.log(`📱 Enviando mensaje de WhatsApp Meta API a ${formattedPhone}...`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      if (data.error?.code === 100) {
        console.error(`⚠️ [WHATSAPP API ERROR 100]: El ID '${WHATSAPP_PHONE_NUMBER_ID}' corresponde al WABA Account ID y NO al Phone Number ID.`);
        console.error(`💡 SOLUCIÓN: En Meta Developers (WhatsApp -> API Setup), copia el 'Identificador del número de teléfono' (Phone Number ID) y configúralo en Railway como WHATSAPP_PHONE_NUMBER_ID.`);
      } else {
        console.error('❌ Error Meta WhatsApp Cloud API:', JSON.stringify(data));
      }
      return { success: false, error: data.error?.message || 'Error en WhatsApp Cloud API', data };
    }

    console.log('✅ Mensaje de WhatsApp enviado con éxito:', data.messages?.[0]?.id);
    return { success: true, data };
  } catch (error: any) {
    console.error('❌ Error al enviar mensaje de WhatsApp:', error.message);
    return { success: false, error: error.message };
  }
};
