import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { sendTenantCredentialsEmail } from '../services/email.service.js';
import { sendWhatsAppMessage } from '../services/whatsapp.service.js';


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

    // Trigger automatic WhatsApp Cloud API message if phone is available
    let whatsappApiSent = false;
    if (cleanPhone) {
      try {
        console.log(`[WHATSAPP API] 📲 Enviando credenciales automáticas a ${cleanPhone}...`);
        const waResult = await sendWhatsAppMessage(cleanPhone, messageText);
        whatsappApiSent = waResult.success;
      } catch (waErr: any) {
        console.error('WhatsApp API dispatch error:', waErr.message);
      }
    }

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

    let statusMsg = 'Inquilino registrado en base de datos.';
    if (emailStatus && whatsappApiSent) {
      statusMsg = 'Inquilino registrado, correo y WhatsApp enviados con éxito.';
    } else if (emailStatus) {
      statusMsg = 'Inquilino registrado y correo enviado con éxito.';
    } else if (whatsappApiSent) {
      statusMsg = 'Inquilino registrado y mensaje de WhatsApp enviado con éxito.';
    }

    return res.status(201).json({
      success: true,
      message: statusMsg,
      emailSent: emailStatus,
      whatsappSent: whatsappApiSent,
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

    // Update Property while preserving existing values if not provided
    if (user.propertyId) {
      const finalUnit = unitNumber && unitNumber.trim() !== '' ? unitNumber : user.property?.unitNumber;
      const finalBlock = block !== undefined ? block : user.property?.block;
      
      await prisma.property.update({
        where: { id: user.propertyId },
        data: {
          unitNumber: finalUnit || '119D',
          block: finalBlock,
        },
      });
    }

    // Update User while preserving existing values if not provided
    const updatedUser = await prisma.user.update({
      where: { id: tenantId },
      data: {
        fullName: fullName && fullName.trim() !== '' ? fullName : user.fullName,
        email: email && email.trim() !== '' ? email : user.email,
        phone: phone !== undefined && phone !== null ? phone : user.phone,
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
      user = await prisma.user.findFirst({
        where: { email: { contains: email, mode: 'insensitive' } },
        include: { property: true, community: true },
      });
    }

    const targetEmail = user?.email || email;
    const targetName = user?.fullName || fullName;
    let targetUnit = user?.property?.unitNumber || unitNumber;
    if (!targetUnit || targetUnit === 'Unidad') {
      targetUnit = '119D';
    }

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

    // Trigger WhatsApp Cloud API dispatch if phone number is available
    let whatsappApiSent = false;
    if (cleanPhone) {
      try {
        console.log(`[WHATSAPP API] 📲 Reenviando credenciales por WhatsApp Cloud API a ${cleanPhone}...`);
        const waResult = await sendWhatsAppMessage(cleanPhone, messageText);
        whatsappApiSent = waResult.success;
      } catch (waErr: any) {
        console.error('WhatsApp API dispatch error:', waErr.message);
      }
    }

    // Send email using Gmail API or SMTP fallback
    const emailResult = await sendTenantCredentialsEmail({
      email: targetEmail,
      fullName: targetName,
      unitNumber: targetUnit,
      block: targetBlock,
      communityName: commName,
      genericPassword,
    });

    const emailError = (emailResult as any).error;
    
    if (!emailResult.success && !whatsappApiSent) {
      return res.status(200).json({
        success: false,
        message: `No se pudo enviar el correo (${emailError || 'Error de envío'}). Puedes enviar manualmente por WhatsApp.`,
        credentialsInfo: { genericPassword, whatsappLink, mailtoLink },
      });
    }

    let resultMsg = '✉️ Credenciales procesadas.';
    if (emailResult.success && whatsappApiSent) {
      resultMsg = `✅ Credenciales enviadas por Correo y WhatsApp Cloud API a ${targetName}.`;
    } else if (emailResult.success) {
      resultMsg = `✉️ Credenciales enviadas exitosamente a ${targetEmail} por correo.`;
    } else if (whatsappApiSent) {
      resultMsg = `📱 Credenciales enviadas exitosamente a ${cleanPhone} vía WhatsApp Cloud API.`;
    }

    return res.json({
      success: true,
      message: resultMsg,
      emailResult,
      whatsappSent: whatsappApiSent,
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

/**
 * Enviar credenciales por la API Oficial de Meta WhatsApp Cloud directamente desde el servidor
 */
export const sendWhatsAppCredentials = async (req: AuthRequest, res: Response) => {
  try {
    const { phone, fullName, unitNumber, communityName, email } = req.body;
    if (!phone || !fullName) {
      return res.status(400).json({ success: false, message: 'Teléfono y Nombre del inquilino son requeridos.' });
    }

    const commName = communityName || 'Residencial Zentary';
    const genericPassword = `Zentary${(unitNumber || '119D').replace(/\s+/g, '')}!`;

    const messageText = `Hola ${fullName}, accesos para la App Zentary - ${commName}.\n\n` +
      `📌 Unidad: ${unitNumber || '119D'}\n` +
      `📧 Correo: ${email || ''}\n` +
      `🔑 Contraseña inicial: ${genericPassword}\n\n` +
      `Al ingresar a la app Zentary se te solicitará cambiar tu contraseña.`;

    console.log(`[WHATSAPP CLOUD API] 📱 Enviando accesos a ${phone} vía Meta Cloud API...`);
    const waResult = await sendWhatsAppMessage(phone, messageText, {
      fullName,
      commName,
      unitNumber: unitNumber || '119D',
      genericPassword,
    });

    if (!waResult.success) {
      return res.status(400).json({
        success: false,
        message: waResult.error || 'No se pudo enviar el mensaje por Meta WhatsApp Cloud API.',
      });
    }

    return res.json({
      success: true,
      message: `📱 Mensaje enviado exitosamente a ${phone} por la API de WhatsApp Cloud de Meta.`,
      data: waResult.data,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al enviar mensaje por WhatsApp API', error: error.message });
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
