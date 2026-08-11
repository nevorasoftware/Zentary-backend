import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
  };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ success: false, message: 'Acceso no autorizado. Token no proporcionado.' });
  }

  const secret = process.env.JWT_SECRET || 'zentary_super_secret_jwt_key_2026';

  jwt.verify(token, secret, (err, decoded: any) => {
    if (err) {
      return res.status(403).json({ success: false, message: 'Token inválido o expirado.' });
    }
    req.user = decoded;
    next();
  });
};
