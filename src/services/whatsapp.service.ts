import dotenv from 'dotenv';
dotenv.config();

const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '1046659641404015';
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || 'EAAcQvTQZCZCroBSAZAbE391ZASW9YlIKOZBpxg0XFmRwqh8F5ZCWmBIsc3st9pyQiUk6o4wlqtFy9ZAHTwmzHde4Tj6EB9n7cqt5KNJZBpIXiY2adreIDDU1qAGkJyRZARMxZAaZBb3urkckbZAUK2H3plxqz3ZCPRiJ86BZCwZBH9CXo9NMAmec6F56lXFSRrVYsOxpzZAWtIMh1eyv39wRJrPBn5Fv5bRUgzwyZCnKDNKrZB3wGAVv3Hn310UoM4r5C8A7kjIlU4usTZBDNAvDgbst4RpMUe0GnZCIFQZDZD';

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
