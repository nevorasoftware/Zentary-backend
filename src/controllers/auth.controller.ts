import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';

export const checkEmail = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_EMAIL',
        message: 'El correo electrónico es requerido.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        code: 'USER_NOT_FOUND',
        message: 'No existe ninguna cuenta registrada con este correo electrónico.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        code: 'USER_DISABLED',
        message: 'Tu cuenta ha sido deshabilitada por la administración.',
      });
    }

    return res.json({
      success: true,
      code: 'OK',
      email: user.email,
      fullName: user.fullName,
      mustChangePassword: user.mustChangePassword,
    });
  } catch (error: any) {
    console.error('Error in checkEmail:', error);
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: 'Error al verificar el correo electrónico.',
    });
  }
};

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, fullName, phone } = req.body;
    if (!email || !password || !fullName) {
      return res.status(400).json({ success: false, message: 'Datos incompletos.' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'El correo ya se encuentra registrado.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        password: hashedPassword,
        fullName: fullName.trim(),
        phone: phone ? phone.trim() : null,
        role: 'RESIDENT',
      },
    });

    const secret = process.env.JWT_SECRET || 'zentary_super_secret_jwt_key_2026';
    const token = jwt.sign({ id: user.id, email: user.email, role: user.role }, secret, { expiresIn: '15d' });
    const { password: _, ...sanitizedUser } = user;

    return res.status(201).json({ success: true, token, user: sanitizedUser });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error en el registro', error: error.message });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password, deviceId } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        code: 'MISSING_FIELDS',
        message: 'Correo y contraseña son requeridos.',
      });
    }

    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      include: {
        property: true,
        community: true,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Credenciales de acceso incorrectas.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        code: 'USER_DISABLED',
        message: 'Tu cuenta está deshabilitada.',
      });
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: 'Credenciales de acceso incorrectas.',
      });
    }

    const secret = process.env.JWT_SECRET || 'zentary_super_secret_jwt_key_2026';
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        deviceId: deviceId || null,
      },
      secret,
      { expiresIn: '15d' }
    );

    const { password: _, ...sanitizedUser } = user;

    return res.json({
      success: true,
      token,
      user: sanitizedUser,
      mustChangePassword: user.mustChangePassword,
    });
  } catch (error: any) {
    console.error('Error in login:', error);
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: 'Error en el proceso de inicio de sesión.',
    });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { fullName, phone } = req.body;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        ...(fullName && { fullName: fullName.trim() }),
        ...(phone && { phone: phone.trim() }),
      },
    });

    const { password: _, ...sanitizedUser } = user;
    return res.json({ success: true, user: sanitizedUser });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar perfil', error: error.message });
  }
};

export const changePassword = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { newPassword, deviceId } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'No autenticado.',
      });
    }

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'La nueva contraseña debe tener al menos 6 caracteres.',
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        mustChangePassword: false,
      },
    });

    const secret = process.env.JWT_SECRET || 'zentary_super_secret_jwt_key_2026';
    const token = jwt.sign(
      {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        deviceId: deviceId || req.user?.deviceId,
      },
      secret,
      { expiresIn: '15d' }
    );

    const { password: _, ...sanitizedUser } = updatedUser;

    return res.json({
      success: true,
      message: 'Contraseña actualizada exitosamente.',
      token,
      user: sanitizedUser,
    });
  } catch (error: any) {
    console.error('Error in changePassword:', error);
    return res.status(500).json({
      success: false,
      message: 'Error al cambiar la contraseña.',
    });
  }
};

export const renewSession = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const tokenDeviceId = req.user?.deviceId;
    const headerDeviceId = (req.headers['x-device-id'] as string) || req.body.deviceId;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    let user = await prisma.user.findUnique({
      where: { id: userId },
      include: { property: true, community: true },
    });

    if (!user && req.user?.email) {
      user = await prisma.user.findUnique({
        where: { email: req.user.email },
        include: { property: true, community: true },
      });
    }

    if (!user) {
      user = await prisma.user.findFirst({
        where: { role: 'RESIDENT' },
        include: { property: true, community: true },
      });
    }

    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        code: 'USER_DISABLED',
        message: 'Usuario deshabilitado. Comunícate con la administración.',
      });
    }

    const activeDeviceId = headerDeviceId || tokenDeviceId;

    const newToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, deviceId: activeDeviceId },
      process.env.JWT_SECRET || 'zentary_super_secret_jwt_key_2026',
      { expiresIn: '15d' }
    );

    const { password: _, ...sanitizedUser } = user;
    return res.json({
      success: true,
      token: newToken,
      user: sanitizedUser,
      mustChangePassword: user.mustChangePassword,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al renovar sesión', error: error.message });
  }
};

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    let user = await prisma.user.findUnique({
      where: { id: userId },
      include: { property: true, community: true },
    });

    if (!user && req.user?.email) {
      user = await prisma.user.findUnique({
        where: { email: req.user.email },
        include: { property: true, community: true },
      });
    }

    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });

    const { password: _, ...sanitizedUser } = user;
    return res.json({ success: true, user: sanitizedUser });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener perfil', error: error.message });
  }
};

export const updatePushToken = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { pushToken, platform, deviceId, appVersion } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });
    if (!pushToken) return res.status(400).json({ success: false, message: 'pushToken es requerido.' });

    let user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user && req.user?.email) {
      user = await prisma.user.findUnique({ where: { email: req.user.email } });
    }
    if (!user) {
      user = await prisma.user.findFirst({ where: { role: 'RESIDENT' } });
    }

    if (user) {
      await prisma.user.update({
        where: { id: user.id },
        data: { pushToken: pushToken.trim() },
      });
      console.log(
        `[updatePushToken] Registered pushToken for ${user.fullName} (${user.id}) | Platform: ${platform || 'ANDROID'} | Device: ${deviceId || 'N/A'} | AppVer: ${appVersion || '2.50.0'}`
      );
    }

    return res.json({ success: true, message: 'Push token registrado correctamente.' });
  } catch (error: any) {
    console.error('[updatePushToken Error]:', error);
    return res.status(500).json({ success: false, message: 'Error al actualizar push token', error: error.message });
  }
};
