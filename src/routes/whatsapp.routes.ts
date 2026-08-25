import { Router } from 'express';
import { verifyWebhook, handleWebhookPayload } from '../controllers/whatsapp.controller.js';

const router = Router();

// Endpoint de verificación (Meta enviará una petición GET al guardar la URL en el panel)
router.get('/webhook', verifyWebhook);

// Endpoint de recepción de eventos (Meta enviará peticiones POST con mensajes y estados)
router.post('/webhook', handleWebhookPayload);

export default router;
