import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';

export const register = async (req: Request, res: Response) => {
  try {
    const { email, password, fullName, phone, role, unitNumber, block } = req.body;

    if (!email || !password || !fullName) {
      return res.status(400).json({ success: false, message: 'Email, contraseña y nombre son obligatorios.' });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'El correo electrónico ya está registrado.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let propertyId: string | undefined;
    if (unitNumber) {
      const property = await prisma.property.create({
        data: {
          unitNumber,
          block: block || null,
        },
      });
      propertyId = property.id;
    }

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        fullName,
        phone: phone || null,
        role: role || 'RESIDENT',
        propertyId: propertyId || null,
      },
    });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'zentary_super_secret_jwt_key_2026',
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      success: true,
      message: 'Usuario registrado exitosamente',
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        avatarUrl: user.avatarUrl,
      },
    });
  } catch (error: any) {
    console.error('Error in register:', error);
    return res.status(500).json({ success: false, message: 'Error en el servidor', error: error.message });
  }
};

export const login = async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email y contraseña requeridos.' });
    }

    const user = await prisma.user.findUnique({
      where: { email },
      include: { property: true, frequentConfig: true },
    });

    if (!user) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Credenciales inválidas.' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET || 'zentary_super_secret_jwt_key_2026',
      { expiresIn: '7d' }
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        phone: user.phone,
        role: user.role,
        avatarUrl: user.avatarUrl,
        property: user.property,
        frequentConfig: user.frequentConfig,
      },
    });
  } catch (error: any) {
    console.error('Error in login:', error);
    return res.status(500).json({ success: false, message: 'Error en el servidor', error: error.message });
  }
};

export const getProfile = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { property: true, frequentConfig: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    const { password, ...userData } = user;
    return res.json({ success: true, user: userData });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error en el servidor', error: error.message });
  }
};

export const updateFrequentConfig = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const { hideFrequentAccessBanner } = req.body;
    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });

    const config = await prisma.frequentAccessConfig.upsert({
      where: { userId },
      update: { hideFrequentAccessBanner: Boolean(hideFrequentAccessBanner) },
      create: { userId, hideFrequentAccessBanner: Boolean(hideFrequentAccessBanner) },
    });

    return res.json({ success: true, config });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar configuración', error: error.message });
  }
};
