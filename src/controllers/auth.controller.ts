import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';

/**
 * POST /api/auth/check-email
 * Validates if the email is registered and if the user is active (not disabled for morosidad)
 */
export const checkEmail = async (req: Request, res: Response) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'El correo electrónico es requerido.' });
    }

    const cleanedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: cleanedEmail },
      select: { id: true, email: true, isActive: true, mustChangePassword: true, fullName: true },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Este correo electrónico no está registrado en el sistema. Comunícate con la administración de tu residencial.',
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        code: 'USER_DISABLED',
        message: 'Usuario deshabilitado. Comunícate con la administración.',
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
    return res.status(500).json({ success: false, message: 'Error al verificar correo', error: error.message });
  }
};

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, fullName, phone, role } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ success: false, message: 'Todos los campos obligatorios deben ser completados.' });
    }

    const cleanedEmail = email.trim().toLowerCase();
    const existingUser = await prisma.user.findUnique({ where: { email: cleanedEmail } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'El usuario ya existe.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email: cleanedEmail,
        password: hashedPassword,
        fullName,
        phone,
        role: role || 'RESIDENT',
        mustChangePassword: false,
      },
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
    );

    const { password: _, ...sanitizedUser } = user;
    return res.status(201).json({ success: true, token, user: sanitizedUser });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error en el registro', error: error.message });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password, deviceId } = req.body;
    const activeDeviceId = deviceId || (req.headers['x-device-id'] as string);

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Correo y contraseña requeridos.' });
    }

    const cleanedEmail = email.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email: cleanedEmail },
      include: { property: true, community: true },
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        code: 'USER_DISABLED',
        message: 'Usuario deshabilitado. Comunícate con la administración.',
      });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Contraseña incorrecta.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, deviceId: activeDeviceId },
      process.env.JWT_SECRET || 'secret',
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
    return res.status(500).json({ success: false, message: 'Error en inicio de sesión', error: error.message });
  }
};

export const changePassword = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { newPassword, deviceId } = req.body;
    const activeDeviceId = deviceId || (req.headers['x-device-id'] as string) || req.user?.deviceId;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'La nueva contraseña debe tener al menos 6 caracteres.' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const user = await prisma.user.update({
      where: { id: userId },
      data: {
        password: hashedPassword,
        mustChangePassword: false,
      },
      include: { property: true, community: true },
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, deviceId: activeDeviceId },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '15d' }
    );

    const { password: _, ...sanitizedUser } = user;
    return res.json({
      success: true,
      message: 'Contraseña actualizada con éxito.',
      token,
      user: sanitizedUser,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al cambiar contraseña', error: error.message });
  }
};

/**
 * POST /api/auth/renew-session
 * Renews session token for 15 additional days if device ID matches and user remains active
 */
export const renewSession = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const tokenDeviceId = req.user?.deviceId;
    const headerDeviceId = (req.headers['x-device-id'] as string) || req.body.deviceId;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { property: true, community: true },
    });

    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        code: 'USER_DISABLED',
        message: 'Usuario deshabilitado. Comunícate con la administración.',
      });
    }

    const activeDeviceId = headerDeviceId || tokenDeviceId;

    if (tokenDeviceId && headerDeviceId && tokenDeviceId !== headerDeviceId) {
      return res.status(401).json({
        success: false,
        code: 'DEVICE_MISMATCH',
        message: 'Sesión iniciada en otro dispositivo.',
      });
    }

    const newToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, deviceId: activeDeviceId },
      process.env.JWT_SECRET || 'secret',
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

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { property: true, community: true },
    });

    if (!user) return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });

    const { password: _, ...sanitizedUser } = user;
    return res.json({ success: true, user: sanitizedUser });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener perfil', error: error.message });
  }
};

export const updateProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id || req.body.userId;
    const { fullName, email, phone, avatarUrl, password } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const updateData: any = {};
    if (fullName && fullName.trim() !== '') updateData.fullName = fullName.trim();
    if (email && email.trim() !== '') updateData.email = email.trim().toLowerCase();
    if (phone !== undefined) updateData.phone = phone;
    if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl;

    if (password && password.trim() !== '') {
      if (password.length < 6) {
        return res.status(400).json({ success: false, message: 'La contraseña debe tener al menos 6 caracteres.' });
      }
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      include: { property: true, community: true },
    });

    const { password: _, ...sanitizedUser } = updatedUser;
    return res.json({
      success: true,
      message: 'Perfil de usuario actualizado correctamente.',
      user: sanitizedUser,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar perfil', error: error.message });
  }
};
