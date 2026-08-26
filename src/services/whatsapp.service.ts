import dotenv from 'dotenv';
dotenv.config();

const WHATSAPP_PHONE_NUMBER_ID = (process.env.WHATSAPP_PHONE_NUMBER_ID || '1354118731108141').trim().replace(/^["']|["']$/g, '');
const WHATSAPP_ACCESS_TOKEN = (process.env.WHATSAPP_ACCESS_TOKEN || 'EAAcQvTQZCZCroBSX9RCREv0kTDNZBybhezyuKlhIaVKEJliVgOQOdDcnpRn6cDDhtXohG9TK4EX5lyy9b6nsN7nJsrCmJZBjTKBziMFzT2dwJS242p7FBCSGiVv7AMb4jaciJHkOZAc8TzdmLviiDvXetkuhydvMTrv3ohwDjEUhHjd3Jdj6UP5aCiAiZBdp3HeAZDZD').trim().replace(/^["']|["']$/g, '');

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

    const langCandidates = [languageCode, 'es_LA', 'es_ES', 'es_MX', 'en_US'].filter(
      (v, i, a) => a.indexOf(v) === i
    );

    let lastError: any = null;

    for (const lang of langCandidates) {
      const payload: any = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedPhone,
        type: 'template',
        template: {
          name: templateName,
          language: {
            code: lang,
          },
        },
      };

      if (bodyParameters.length > 0) {
        payload.template.components = [
          {
            type: 'body',
            parameters: bodyParameters,
          },
        ];
      }

      console.log(`📱 Probando envío de plantilla '${templateName}' en idioma '${lang}' a ${formattedPhone}...`);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      console.log(`📱 Respuesta Meta (${templateName} - ${lang}):`, JSON.stringify(data));

      if (response.ok) {
        console.log(`✅ Plantilla '${templateName}' (${lang}) enviada con éxito. Message ID:`, data.messages?.[0]?.id);
        return { success: true, data };
      }

      lastError = data;
      if (data.error?.code === 132001) {
        console.warn(`⚠️ La plantilla '${templateName}' no se encontró con el código de idioma '${lang}'. Probando siguiente variante...`);
        continue;
      }

      break;
    }

    console.error('❌ Error Meta WhatsApp Template API:', JSON.stringify(lastError));
    return { success: false, error: lastError?.error?.message || 'Error al enviar plantilla', data: lastError };
  } catch (error: any) {
    console.error('❌ Error al enviar plantilla de WhatsApp:', error.message);
    return { success: false, error: error.message };
  }
};

/**
 * Sends automated WhatsApp message via Meta Cloud API.
 * Tries template 'notificacion_residencia' or 'credencial_inquilino' first, then falls back to text.
 */
export const sendWhatsAppMessage = async (toPhone: string, messageText: string, templateParams?: { fullName: string; commName: string; unitNumber: string; genericPassword: string }): Promise<{ success: boolean; data?: any; error?: string }> => {
  try {
    const formattedPhone = normalizePhoneNumber(toPhone);
    if (!formattedPhone) {
      console.warn('⚠️ WhatsApp notification skipped: invalid phone number provided:', toPhone);
      return { success: false, error: 'Número de teléfono inválido' };
    }

    // 1. If template parameters are provided, try template 'notificacion_residencial' first
    if (templateParams) {
      const preferredTemplate = process.env.WHATSAPP_TEMPLATE_NAME || 'notificacion_residencial';
      console.log(`📱 Intentando enviar plantilla principal '${preferredTemplate}'...`);
      
      const templateResult = await sendWhatsAppTemplate(
        formattedPhone,
        preferredTemplate,
        process.env.WHATSAPP_TEMPLATE_LANG || 'es',
        [templateParams.fullName, templateParams.commName, templateParams.unitNumber, templateParams.genericPassword]
      );

      if (templateResult.success) {
        return templateResult;
      }
      
      // Secondary fallback template if preferred fails
      if (preferredTemplate !== 'notificacion_residencia') {
        console.log(`📱 Intentando plantilla de respaldo 'notificacion_residencia'...`);
        const fallbackResult = await sendWhatsAppTemplate(
          formattedPhone,
          'notificacion_residencia',
          'es',
          [templateParams.fullName, templateParams.commName, templateParams.unitNumber, templateParams.genericPassword]
        );
        if (fallbackResult.success) {
          return fallbackResult;
        }
      }
      console.warn('⚠️ Fallback to free-text message as template was not matched or approved yet.');
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

