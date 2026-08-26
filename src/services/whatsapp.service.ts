import dotenv from 'dotenv';
dotenv.config();

let rawPhoneId = (process.env.WHATSAPP_PHONE_NUMBER_ID || '1354118731108141').trim().replace(/^["']|["']$/g, '');
if (!rawPhoneId || rawPhoneId === '1182136594990571') {
  rawPhoneId = '1354118731108141';
}
const WHATSAPP_PHONE_NUMBER_ID = rawPhoneId;
const WHATSAPP_ACCESS_TOKEN = (process.env.WHATSAPP_ACCESS_TOKEN || 'EAAcQvTQZCZCroBSX9RCREv0kTDNZBybhezyuKlhIaVKEJliVgOQOdDcnpRn6cDDhtXohG9TK4EX5lyy9b6nsN7nJsrCmJZBjTKBziMFzT2dwJS242p7FBCSGiVv7AMb4jaciJHkOZAc8TzdmLviiDvXetkuhydvMTrv3ohwDjEUhHjd3Jdj6UP5aCiAiZBdp3HeAZDZD')
  .trim()
  .replace(/^Bearer\s+/i, '')
  .replace(/^["']|["']$/g, '');

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
 * Sends an approved WhatsApp Template message via Meta Cloud API
 * Matches Postman Option A payload structure exactly.
 */
export const sendWhatsAppTemplate = async (
  toPhone: string,
  templateName: string = 'notificacion_residencial',
  languageCode: string = 'es',
  params: string[] = []
): Promise<{ success: boolean; data?: any; error?: string }> => {
  try {
    const formattedPhone = normalizePhoneNumber(toPhone);
    if (!formattedPhone) {
      return { success: false, error: 'Número de teléfono inválido' };
    }

    const endpoint = `https://graph.facebook.com/v19.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const bodyParameters = params.map((text) => ({
      type: 'text',
      text,
    }));

    const payload: any = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: formattedPhone,
      type: 'template',
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        components: [
          {
            type: 'body',
            parameters: bodyParameters,
          },
        ],
      },
    };

    console.log(`[POSTMAN MATCH] 📱 Enviando plantilla '${templateName}' (${languageCode}) a ${formattedPhone}...`);
    console.log(`[ENDPOINT]: ${endpoint}`);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    console.log(`📱 Respuesta Meta (${templateName}):`, JSON.stringify(data));

    if (response.ok && data.messages?.[0]?.id) {
      console.log(`✅ Plantilla '${templateName}' enviada con éxito. Message ID:`, data.messages[0].id);
      return { success: true, data };
    }

    // If initial language code fails with 132001, try fallback language variants
    if (data.error?.code === 132001 && languageCode === 'es') {
      for (const fallbackLang of ['es_LA', 'es_MX', 'es_ES']) {
        console.log(`⚠️ Probando variante de idioma '${fallbackLang}'...`);
        payload.template.language.code = fallbackLang;
        const resFb = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
        const dataFb = await resFb.json();
        console.log(`📱 Respuesta Meta fallback (${fallbackLang}):`, JSON.stringify(dataFb));
        if (resFb.ok && dataFb.messages?.[0]?.id) {
          console.log(`✅ Plantilla enviada con éxito usando '${fallbackLang}'. Message ID:`, dataFb.messages[0].id);
          return { success: true, data: dataFb };
        }
      }
    }

    console.error('❌ Error Meta WhatsApp Template API:', JSON.stringify(data));
    return { success: false, error: data.error?.message || 'Error al enviar plantilla', data };
  } catch (error: any) {
    console.error('❌ Error al enviar plantilla de WhatsApp:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Sends automated WhatsApp message via Meta Cloud API.
 */
export const sendWhatsAppMessage = async (toPhone: string, messageText: string, templateParams?: { fullName: string; commName: string; unitNumber: string; genericPassword: string }): Promise<{ success: boolean; data?: any; error?: string }> => {
  try {
    const formattedPhone = normalizePhoneNumber(toPhone);
    if (!formattedPhone) {
      console.warn('⚠️ WhatsApp notification skipped: invalid phone number provided:', toPhone);
      return { success: false, error: 'Número de teléfono inválido' };
    }

    // 1. Send using approved template 'notificacion_residencial'
    if (templateParams) {
      console.log(`📱 Enviando plantilla 'notificacion_residencial' a ${formattedPhone}...`);
      const templateResult = await sendWhatsAppTemplate(
        formattedPhone,
        process.env.WHATSAPP_TEMPLATE_NAME || 'notificacion_residencial',
        process.env.WHATSAPP_TEMPLATE_LANG || 'es',
        [templateParams.fullName, templateParams.commName, templateParams.unitNumber, templateParams.genericPassword]
      );

      if (templateResult.success) {
        return templateResult;
      }
      return templateResult; // Return exact template error instead of masking with free text
    }

    // 2. Fallback to free text message
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

    console.log(`📱 Enviando mensaje de WhatsApp de texto a ${formattedPhone}...`);

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
      console.error('❌ Error Meta WhatsApp Cloud API:', JSON.stringify(data));
      return { success: false, error: data.error?.message || 'Error en WhatsApp Cloud API', data };
    }

    console.log('✅ Mensaje de WhatsApp enviado con éxito:', data.messages?.[0]?.id);
    return { success: true, data };
  } catch (error: any) {
    console.error('❌ Error al enviar mensaje de WhatsApp:', error.message);
    return { success: false, error: error.message };
  }
};

