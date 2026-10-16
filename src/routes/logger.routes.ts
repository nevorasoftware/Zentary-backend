import { Router, Request, Response } from 'express';
import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = Router();

/**
 * POST /api/logs/app
 * Receives frontend / mobile app logs and outputs them with [MOBILE APP LOG] tag
 */
router.post('/app', authenticateToken, (req: Request, res: Response) => {
  if (JSON.stringify(req.body ?? {}).length > 10_000) {
    return res.status(413).json({ success: false, message: 'El registro enviado es demasiado grande.' });
  }

  const { level, action, message, details } = req.body;
  const timestamp = new Date().toISOString();

  const safeMessage = String(message ?? '').slice(0, 500);

  const logPrefix = `[MOBILE APP LOG] [${timestamp}] [${(level || 'INFO').toUpperCase()}] [${action || 'GENERAL'}]:`;

  if (level === 'error') {
    console.error(`❌ ${logPrefix}`, safeMessage);
  } else if (level === 'warn') {
    console.warn(`⚠️ ${logPrefix}`, safeMessage);
  } else {
    console.log(`📱 ${logPrefix}`, safeMessage);
  }

  return res.json({ success: true });
});

export default router;
