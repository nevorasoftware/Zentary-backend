import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { sendTenantCredentialsEmail } from '../services/email.service.js';

export const getUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { role, search, communityId } = req.query;

    const where: any = {};
    if (role) where.role = role as string;
    if (communityId) where.communityId = communityId as string;
    if (search) {
      where.OR = [
        { fullName: { contains: search as string, mode: 'insensitive' } },
        { email: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      include: { property: true, community: true },
      orderBy: { createdAt: 'desc' },
    });

    const sanitizedUsers = users.map(({ password, ...u }) => u);
    return res.json({ success: true, users: sanitizedUsers });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener usuarios', error: error.message });
  }
};

export const toggleUserAccess = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isActive: Boolean(isActive) },
      include: { property: true },
    });

    const { password, ...sanitizedUser } = user;
    return res.json({
      success: true,
      message: `Acceso del usuario ${isActive ? 'activado' : 'desactivado'} con éxito.`,
      user: sanitizedUser,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar acceso de usuario', error: error.message });
  }
};

/**
 * Registra un nuevo inquilino en la residencial especificada,
 * genera su usuario con contraseña genérica y marca mustChangePassword: true.
 */
export const registerTenant = async (req: AuthRequest, res: Response) => {
  try {
    const { fullName, unitNumber, block, email, phone, communityId, communityName } = req.body;

    if (!fullName || !unitNumber || !email) {
      return res.status(400).json({
        success: false,
        message: 'Nombre completo, número de unidad y correo electrónico son requeridos.',
      });
    }

    // Check if user email already exists
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'El correo electrónico ya se encuentra registrado.',
      });
    }

    // Find or create Community
    let community = null;
    if (communityId) {
      community = await prisma.community.findUnique({ where: { id: communityId } });
    }
    if (!community) {
      community = await prisma.community.findFirst();
      if (!community) {
        community = await prisma.community.create({
          data: { name: communityName || 'Residencial Zentary' },
        });
      }
    }

    // Find or Create Property
    let property = await prisma.property.findFirst({
      where: {
        unitNumber,
        block: block || null,
        communityId: community.id,
      },
    });

    if (!property) {
      property = await prisma.property.create({
        data: {
          unitNumber,
          block: block || null,
          communityId: community.id,
        },
      });
    }

    // Generic password for initial login
    const genericPassword = `Zentary${unitNumber.replace(/\s+/g, '')}!`;
    const hashedPassword = await bcrypt.hash(genericPassword, 10);

    // Create User with mustChangePassword = true
    const newTenant = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        mustChangePassword: true,
        fullName,
        phone: phone || null,
        role: 'RESIDENT',
        isActive: true,
        communityId: community.id,
        propertyId: property.id,
      },
      include: {
        property: true,
        community: true,
      },
    });

    // Clean phone number for WhatsApp link
    const cleanPhone = (phone || '').replace(/[^\d]/g, '');

    // Formatted credential messages for Email and WhatsApp
    const messageText = `Hola ${fullName}, bienvenido a ${community.name}. Se ha habilitado tu acceso a la aplicación móvil Zentary.\n\n` +
      `📌 Unidad: ${unitNumber} ${block ? `(${block})` : ''}\n` +
      `📧 Correo: ${email}\n` +
      `🔑 Contraseña inicial: ${genericPassword}\n\n` +
      `Por tu seguridad, la aplicación te solicitará cambiar tu contraseña la primera vez que inicies sesión.`;

    const whatsappLink = cleanPhone
      ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(messageText)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(messageText)}`;

    const mailtoLink = `mailto:${email}?subject=${encodeURIComponent(`Accesos a la App Zentary - ${community.name}`)}&body=${encodeURIComponent(messageText)}`;

    const { password, ...sanitizedUser } = newTenant;

    // Trigger Gmail Email dispatch in background
    let emailStatus = false;
    let emailResultInfo = null;
    try {
      emailResultInfo = await sendTenantCredentialsEmail({
        email,
        fullName,
        unitNumber,
        block,
        communityName: community.name,
        genericPassword,
      });
      emailStatus = emailResultInfo?.success || false;
    } catch (err: any) {
      console.error('Email dispatch error:', err);
    }

    return res.status(201).json({
      success: true,
      message: emailStatus
        ? 'Inquilino registrado y correo enviado por Gmail API con éxito.'
        : 'Inquilino registrado en base de datos. (Configura GMAIL_APP_PASSWORD en Railway para el envío automático).',
      emailSent: emailStatus,
      tenant: sanitizedUser,
      credentialsInfo: {
        genericPassword,
        mustChangePassword: true,
        messageText,
        whatsappLink,
        mailtoLink,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al registrar inquilino', error: error.message });
  }
};

/**
 * Editar datos del inquilino (Nombre, correo, teléfono, unidad)
 */
export const updateTenant = async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { fullName, email, phone, unitNumber, block } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: tenantId },
      include: { property: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Inquilino no encontrado.' });
    }

    // Update Property if unitNumber provided
    if (unitNumber && user.propertyId) {
      await prisma.property.update({
        where: { id: user.propertyId },
        data: { unitNumber, block: block || null },
      });
    }

    // Update User details
    const updatedUser = await prisma.user.update({
      where: { id: tenantId },
      data: {
        fullName: fullName || user.fullName,
        email: email || user.email,
        phone: phone !== undefined ? phone : user.phone,
      },
      include: { property: true, community: true },
    });

    const { password, ...sanitizedUser } = updatedUser;
    return res.json({
      success: true,
      message: 'Información del inquilino actualizada correctamente.',
      tenant: sanitizedUser,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar inquilino', error: error.message });
  }
};

/**
 * Reenviar credenciales por correo mediante Gmail API
 */
export const resendTenantCredentials = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, email, fullName, unitNumber, block, communityName } = req.body;

    let user = null;
    if (userId) {
      user = await prisma.user.findUnique({
        where: { id: userId },
        include: { property: true, community: true },
      });
    } else if (email) {
      user = await prisma.user.findUnique({
        where: { email },
        include: { property: true, community: true },
      });
    }

    const targetEmail = user?.email || email;
    const targetName = user?.fullName || fullName;
    const targetUnit = user?.property?.unitNumber || unitNumber || 'Unidad';
    const targetBlock = user?.property?.block || block;
    const commName = user?.community?.name || communityName || 'Residencial Zentary';

    if (!targetEmail || !targetName) {
      return res.status(400).json({ success: false, message: 'Correo y nombre del inquilino son requeridos.' });
    }

    const genericPassword = `Zentary${targetUnit.replace(/\s+/g, '')}!`;

    // Re-set password and mustChangePassword if user exists
    if (user) {
      const hashedPassword = await bcrypt.hash(genericPassword, 10);
      await prisma.user.update({
        where: { id: user.id },
        data: {
          password: hashedPassword,
          mustChangePassword: true,
        },
      });
    }

    // Send email using Gmail API
    const emailResult = await sendTenantCredentialsEmail({
      email: targetEmail,
      fullName: targetName,
      unitNumber: targetUnit,
      block: targetBlock,
      communityName: commName,
      genericPassword,
    });

    const cleanPhone = user?.phone ? user.phone.replace(/[^\d]/g, '') : '';
    const messageText = `Hola ${targetName}, recordatorio de accesos para ${commName}.\n\n` +
      `📌 Unidad: ${targetUnit}\n` +
      `📧 Correo: ${targetEmail}\n` +
      `🔑 Contraseña inicial: ${genericPassword}\n\n` +
      `Al iniciar sesión en Zentary, se te pedirá cambiar tu clave.`;

    const whatsappLink = cleanPhone
      ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encodeURIComponent(messageText)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(messageText)}`;

    const mailtoLink = `mailto:${targetEmail}?subject=${encodeURIComponent(`Accesos a Zentary - ${commName}`)}&body=${encodeURIComponent(messageText)}`;

    const emailError = (emailResult as any).error || 'Error en autenticación o envío';
    if (!emailResult.success) {
      return res.status(200).json({
        success: false,
        message: `No se pudo enviar por Gmail API: ${emailError}.`,
        credentialsInfo: { genericPassword, whatsappLink, mailtoLink },
      });
    }

    return res.json({
      success: true,
      message: `✉️ Credenciales enviadas exitosamente a ${targetEmail} vía Gmail API.`,
      emailResult,
      credentialsInfo: {
        genericPassword,
        whatsappLink,
        mailtoLink,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al reenviar credenciales', error: error.message });
  }
};

export const getCommunityConfig = async (req: AuthRequest, res: Response) => {
  try {
    let community = await prisma.community.findFirst();
    if (!community) {
      community = await prisma.community.create({
        data: { name: 'Residencial Zentary' },
      });
    }
    return res.json({ success: true, community });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener residencial', error: error.message });
  }
};

export const updateCommunityConfig = async (req: AuthRequest, res: Response) => {
  try {
    const { id, name, address, city } = req.body;

    let community;
    if (id) {
      community = await prisma.community.update({
        where: { id },
        data: { name, address, city },
      });
    } else {
      const existing = await prisma.community.findFirst();
      if (existing) {
        community = await prisma.community.update({
          where: { id: existing.id },
          data: { name, address, city },
        });
      } else {
        community = await prisma.community.create({
          data: { name: name || 'Residencial Zentary', address, city },
        });
      }
    }

    return res.json({
      success: true,
      message: 'Nombre del residencial/condominio actualizado correctamente.',
      community,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar residencial', error: error.message });
  }
};

export const getDashboardStats = async (_req: AuthRequest, res: Response) => {
  try {
    const totalResidents = await prisma.user.count({ where: { role: 'RESIDENT' } });
    const activeVisits = await prisma.visit.count({ where: { category: 'EN_CURSO', status: 'IN_PROGRESS' } });
    const pendingParcels = await prisma.parcel.count({ where: { status: 'PENDING' } });
    const openPqrs = await prisma.pqrs.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } });
    const totalPendingPayments = await prisma.payment.aggregate({
      where: { status: 'PENDING' },
      _sum: { amount: true },
    });

    return res.json({
      success: true,
      stats: {
        totalResidents,
        activeVisits,
        pendingParcels,
        openPqrs,
        pendingPaymentsSum: totalPendingPayments._sum.amount || 0,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener estadísticas', error: error.message });
  }
};
