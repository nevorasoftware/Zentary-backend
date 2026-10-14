import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';

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

  if (!token) {
    return res.status(401).json({
      success: false,
      code: 'NO_TOKEN',
      message: 'Sesión no válida o token expirado.',
    });
  }

  const secret = process.env.JWT_SECRET as string;

  jwt.verify(token, secret, async (err, decoded: any) => {
    if (err) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_TOKEN',
        message: 'Sesión no válida o token expirado.',
      });
    }
    req.user = decoded;
    // La existencia, el estado y la residencial se validan en el servidor en cada solicitud
    try {
      const user = await prisma.user.findUnique({
        where: { id: decoded.id },
        select: { tenantId: true, isActive: true, role: true },
      });
      if (!user) {
        return res.status(401).json({
          success: false,
          code: 'INVALID_TOKEN',
          message: 'Sesión no válida o token expirado.',
        });
      }
      if (!user.isActive) {
        return res.status(403).json({
          success: false,
          code: 'USER_DISABLED',
          message: 'Usuario deshabilitado. Comunícate con la administración.',
        });
      }
      // El rol vigente es el de la base de datos, no el del token
      req.user!.role = user.role;
      if (user.role === 'SUPER_ADMIN') {
        // Super Admin: puede operar entre residenciales indicando el tenant por cabecera
        req.tenantId = (req.headers['x-tenant-id'] as string) || user.tenantId || undefined;
      } else {
        if (!user.tenantId) {
          return res.status(403).json({
            success: false,
            code: 'TENANT_REQUIRED',
            message: 'Tu cuenta no está asociada a una residencial. Contacta a la administración.',
          });
        }
        // Multi-tenant resolution: se resuelve en el servidor, sin depender de cabeceras
        req.tenantId = user.tenantId;
      }
      req.user!.tenantId = req.tenantId;
    } catch (error: any) {
      return res.status(500).json({ success: false, message: 'Error al validar la sesión', error: error.message });
    }
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
