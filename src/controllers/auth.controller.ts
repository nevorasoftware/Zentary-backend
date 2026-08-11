import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, fullName, phone, role } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ success: false, message: 'Todos los campos obligatorios deben ser completados.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'El usuario ya existe.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: {
        email,
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
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Correo y contraseña requeridos.' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { property: true, community: true },
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Tu acceso a la aplicación ha sido suspendido por la administración.',
      });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'secret',
      { expiresIn: '7d' }
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
    const { newPassword } = req.body;

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
    });

    const { password: _, ...sanitizedUser } = user;
    return res.json({
      success: true,
      message: 'Contraseña actualizada con éxito.',
      user: sanitizedUser,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al cambiar contraseña', error: error.message });
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
