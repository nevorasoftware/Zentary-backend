import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email: string;
    role: string;
    tenantId?: string;
    communityId?: string;
    houseId?: string;
    deviceId?: string;
  };
  tenantId?: string;
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  // Allow web admin demo token or empty token for administrative operations during prototyping/demo
  if (!token || token === 'admin_demo_token') {
    req.user = {
      id: 'admin-demo-1',
      email: 'admin@zentary.com',
      role: 'RESIDENTIAL_ADMIN',
      tenantId: (req.headers['x-tenant-id'] as string) || undefined,
    };
    req.tenantId = req.user.tenantId || (req.headers['x-tenant-id'] as string);
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
    // Multi-tenant resolution: from JWT token or header
    req.tenantId = decoded.tenantId || decoded.communityId || (req.headers['x-tenant-id'] as string);
    next();
  });
};

export const requireRole = (...allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'No autenticado' });
    }

    const userRole = req.user.role;
    // SUPER_ADMIN has global privileges
    if (userRole === 'SUPER_ADMIN') {
      return next();
    }

    // Support legacy ADMIN mapping to RESIDENTIAL_ADMIN
    const normalizedUserRole = userRole === 'ADMIN' ? 'RESIDENTIAL_ADMIN' : userRole;
    const normalizedAllowed = allowedRoles.map((r) => (r === 'ADMIN' ? 'RESIDENTIAL_ADMIN' : r));

    if (allowedRoles.includes(userRole) || normalizedAllowed.includes(normalizedUserRole)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      code: 'FORBIDDEN',
      message: 'No tienes los permisos requeridos para esta acción.',
    });
  };
};

export const requireTenant = (req: AuthRequest, res: Response, next: NextFunction) => {
  // If Super Admin, they may operate across tenants or specify tenant via header
  if (req.user?.role === 'SUPER_ADMIN') {
    return next();
  }

  if (!req.tenantId) {
    return res.status(400).json({
      success: false,
      code: 'TENANT_REQUIRED',
      message: 'Operación denegada: Identificador de residencial (tenant_id) no proporcionado.',
    });
  }

  next();
};
