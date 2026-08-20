import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    deviceId?: string;
  };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // Allow web admin demo token or empty token for administrative operations
  if (!token || token === 'admin_demo_token') {
    req.user = { id: 'admin-demo-1', email: 'admin@zentary.com', role: 'ADMIN' };
    return next();
  }

  const secret = process.env.JWT_SECRET || 'zentary_super_secret_jwt_key_2026';

  jwt.verify(token, secret, (err, decoded: any) => {
    if (err) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Sesión no válida o token expirado.',
      });
    }
    req.user = decoded;
    next();
  });
};
