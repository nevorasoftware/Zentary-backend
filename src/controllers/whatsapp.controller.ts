import { Request, Response } from 'express';
import dotenv from 'dotenv';
dotenv.config();

const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || 'zentary_whatsapp_verify_token_2026';

/**
 * Webhook Verification Handler (GET)
 * Used by Meta Developers to verify Callback URL ownership.
 */
export const verifyWebhook = (req: Request, res: Response) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode && token) {
      if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN) {
        console.log('✅ Webhook WhatsApp verificado exitosamente por Meta.');
        return res.status(200).send(challenge);
      } else {
        console.warn('⚠️ Fallo en la verificación del Webhook de WhatsApp: Token no coincide.');
        return res.sendStatus(403);
      }
    }

    return res.status(400).json({ error: 'Parámetros de verificación faltantes' });
  } catch (error: any) {
    console.error('❌ Error en verificación de Webhook WhatsApp:', error.message);
    return res.status(500).json({ error: 'Error interno en la verificación' });
  }
};

/**
 * Webhook Event Handler (POST)
 * Receives incoming messages, delivery statuses, and interactive replies from WhatsApp.
 */
export const handleWebhookPayload = (req: Request, res: Response) => {
  try {
    const body = req.body;

    if (body.object === 'whatsapp_business_account') {
      body.entry?.forEach((entry: any) => {
        entry.changes?.forEach((change: any) => {
          const value = change.value;
          if (value?.messages) {
            value.messages.forEach((message: any) => {
              console.log(`📩 Mensaje entrante de WhatsApp de [${message.from}]:`, message.text?.body || message.type);
            });
          }
          if (value?.statuses) {
            value.statuses.forEach((status: any) => {
              console.log(`📊 Actualización de estado WhatsApp [${status.id}]: ${status.status}`);
            });
          }
        });
      });

      return res.status(200).send('EVENT_RECEIVED');
    }

    return res.sendStatus(404);
  } catch (error: any) {
    console.error('❌ Error procesando evento de Webhook WhatsApp:', error.message);
    return res.status(500).send('Error interno');
  }
};
