import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { sendTenantCredentialsEmail } from '../services/email.service.js';
import { sendWhatsAppMessage } from '../services/whatsapp.service.js';

const tenantScope = (req: AuthRequest) => (req.tenantId ? { tenantId: req.tenantId } : {});

// Convención: Community.id === Tenant.id. Devuelve (o crea) el Community de la residencial.
const resolveCommunityForTenant = async (tenantId: string) => {
  const existing = await prisma.community.findUnique({ where: { id: tenantId } });
  if (existing) return existing;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  return prisma.community.create({
    data: {
      id: tenantId,
      name: tenant?.name || 'Residencial Zentary',
      address: tenant?.address,
      city: tenant?.city,
      logoUrl: tenant?.logoUrl,
    },
  });
};

const normalizeUnit = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
// Contraseña inicial aleatoria (sin caracteres ambiguos: 0 O 1 l I)
const generateInitialPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[randomInt(chars.length)]).join('');
};
const normalizeBlock = (v: unknown) => { const b = typeof v === 'string' ? v.trim() : ''; return b ? b : null; };

const findOrCreateHouse = async (tenantId: string, unitNumber: string, block: string | null) => {
  const where = {
    tenantId,
    unitNumber: { equals: unitNumber, mode: 'insensitive' as const },
    block: block === null ? null : { equals: block, mode: 'insensitive' as const },
  };
  const existing = await prisma.house.findFirst({ where });
  if (existing) return existing;
  try {
    return await prisma.house.create({ data: { tenantId, unitNumber, block } });
  } catch (e: any) {
    if (e?.code === 'P2002') { const again = await prisma.house.findFirst({ where }); if (again) return again; }
    throw e;
  }
};

export const getUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { role, search, communityId } = req.query;

    const where: any = { ...tenantScope(req) };
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
      include: { property: true, community: true, house: true },
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

    const existing = await prisma.user.findFirst({ where: { id: userId, role: { in: ['RESIDENT', 'GUARD'] }, ...tenantScope(req) } });
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isActive: Boolean(isActive) },
      include: { property: true, community: true, house: true },
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

    const unit = normalizeUnit(unitNumber);
    const blk = normalizeBlock(block);
    if (!unit) {
      return res.status(400).json({
        success: false,
        message: 'Nombre completo, número de unidad y correo electrónico son requeridos.',
      });
    }
    if (!req.tenantId) {
      return res.status(400).json({ success: false, message: 'Residencial no resuelta.' });
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
    const community = await resolveCommunityForTenant(req.tenantId);

    // Find or Create Property
    let property = await prisma.property.findFirst({
      where: {
        unitNumber: unit,
        block: blk,
        communityId: community.id,
      },
    });

    if (!property) {
      property = await prisma.property.create({
        data: {
          unitNumber: unit,
          block: blk,
          communityId: community.id,
        },
      });
    }

    // Generic password for initial login
    const genericPassword = generateInitialPassword();
    const hashedPassword = await bcrypt.hash(genericPassword, 10);

    const house = await findOrCreateHouse(req.tenantId, unit, blk);

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
        tenantId: req.tenantId,
        propertyId: property.id,
        houseId: house.id,
      },
      include: {
        property: true,
        community: true,
        house: true,
      },
    });

    // Clean phone number for WhatsApp link
    const cleanPhone = (phone || '').replace(/[^\d]/g, '');

    // Formatted credential messages for Email and WhatsApp
    const messageText = `Hola ${fullName}, bienvenido a ${community.name}. Se ha habilitado tu acceso a la aplicación móvil Zentary.\n\n` +
      `📌 Unidad: ${unit} ${blk ? `(${blk})` : ''}\n` +
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
        unitNumber: unit,
        block: blk ?? undefined,
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

    if (req.user?.role !== 'SUPER_ADMIN' && user.tenantId !== req.tenantId) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    if (!['RESIDENT', 'GUARD'].includes(user.role)) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    const finalUnit = normalizeUnit(unitNumber) || user.property?.unitNumber;
    const finalBlock = block !== undefined ? normalizeBlock(block) : (user.property?.block ?? null);

    // Update Property while preserving existing values if not provided
    if (user.propertyId) {
      await prisma.property.update({
        where: { id: user.propertyId },
        data: {
          unitNumber: finalUnit || '119D',
          block: finalBlock,
        },
      });
    }

    // Re-ligar la vivienda (House) del residente según la unidad final
    let houseId: string | undefined;
    const houseTenantId = user.tenantId || req.tenantId;
    if (finalUnit && houseTenantId) {
      const house = await findOrCreateHouse(houseTenantId, finalUnit, finalBlock);
      houseId = house.id;
    }

    // Update User while preserving existing values if not provided
    const updatedUser = await prisma.user.update({
      where: { id: tenantId },
      data: {
        fullName: fullName && fullName.trim() !== '' ? fullName : user.fullName,
        email: email && email.trim() !== '' ? email : user.email,
        phone: phone !== undefined && phone !== null ? phone : user.phone,
        ...(houseId ? { houseId } : {}),
      },
      include: { property: true, community: true, house: true },
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
      user = await prisma.user.findFirst({
        where: { id: userId, role: { in: ['RESIDENT', 'GUARD'] }, ...tenantScope(req) },
        include: { property: true, community: true },
      });
    } else if (email) {
      user = await prisma.user.findFirst({
        where: { email: { equals: String(email).trim(), mode: 'insensitive' }, role: { in: ['RESIDENT', 'GUARD'] }, ...tenantScope(req) },
        include: { property: true, community: true },
      });
    }

    if (userId && !user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    const targetEmail = user?.email || email;
    const targetName = user?.fullName || fullName;
    const targetUnit = user?.property?.unitNumber || unitNumber;
    if (!targetUnit || targetUnit === 'Unidad') {
      return res.status(400).json({ success: false, message: 'La unidad del inquilino es requerida.' });
    }

    const targetBlock = user?.property?.block || block;
    const commName = user?.community?.name || communityName || 'Residencial Zentary';

    if (!targetEmail || !targetName) {
      return res.status(400).json({ success: false, message: 'Correo y nombre del inquilino son requeridos.' });
    }

    const genericPassword = generateInitialPassword();

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
      // Con usuario existente no se restableció la contraseña: no se devuelve la generada
      // (ni los enlaces que la contienen), porque no sería la vigente.
      return res.status(200).json({
        success: false,
        passwordReset: false,
        message: `No se pudo enviar el correo (${emailError || 'Error de envío'}). Puedes enviar manualmente por WhatsApp.`,
        ...(user ? {} : { credentialsInfo: { genericPassword, whatsappLink, mailtoLink } }),
      });
    }

    // Envío confirmado: se restablece la contraseña si el usuario existe
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
      passwordReset: !!user,
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
    const { userId, phone, fullName, communityName, email } = req.body;
    if (!phone || !fullName) {
      return res.status(400).json({ success: false, message: 'Teléfono y Nombre del inquilino son requeridos.' });
    }

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Se requiere el usuario.' });
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, role: { in: ['RESIDENT', 'GUARD'] }, ...tenantScope(req) },
      include: { house: true, property: true },
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    const unitNumber = user.house?.unitNumber || user.property?.unitNumber;
    if (!unitNumber) {
      return res.status(400).json({ success: false, message: 'La unidad del inquilino es requerida.' });
    }

    const commName = communityName || 'Residencial Zentary';
    const genericPassword = generateInitialPassword();

    const messageText = `Hola ${fullName}, accesos para la App Zentary - ${commName}.\n\n` +
      `📌 Unidad: ${unitNumber}\n` +
      `📧 Correo: ${email || ''}\n` +
      `🔑 Contraseña inicial: ${genericPassword}\n\n` +
      `Al ingresar a la app Zentary se te solicitará cambiar tu contraseña.`;

    console.log(`[WHATSAPP CLOUD API] 📱 Enviando accesos a ${phone} vía Meta Cloud API...`);
    const waResult = await sendWhatsAppMessage(phone, messageText, {
      fullName,
      commName,
      unitNumber: unitNumber,
      genericPassword,
    });

    if (!waResult.success) {
      return res.status(400).json({
        success: false,
        passwordReset: false,
        message: waResult.error || 'No se pudo enviar el mensaje por Meta WhatsApp Cloud API.',
      });
    }

    // Envío confirmado: se restablece la contraseña para que la enviada sea la vigente
    const hashedPassword = await bcrypt.hash(genericPassword, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: hashedPassword,
        mustChangePassword: true,
      },
    });

    return res.json({
      success: true,
      passwordReset: true,
      message: `📱 Mensaje enviado exitosamente a ${phone} por la API de WhatsApp Cloud de Meta.`,
      data: waResult.data,
      credentialsInfo: { genericPassword },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al enviar mensaje por WhatsApp API', error: error.message });
  }
};


export const getCommunityConfig = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.tenantId) {
      return res.status(400).json({ success: false, code: 'TENANT_REQUIRED', message: 'Selecciona una residencial.' });
    }
    const community = await resolveCommunityForTenant(req.tenantId);
    return res.json({ success: true, community });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener residencial', error: error.message });
  }
};

export const updateCommunityConfig = async (req: AuthRequest, res: Response) => {
  try {
    const { name, address, city } = req.body;
    if (!req.tenantId) {
      return res.status(400).json({ success: false, code: 'TENANT_REQUIRED', message: 'Selecciona una residencial.' });
    }

    await resolveCommunityForTenant(req.tenantId);
    const community = await prisma.community.update({
      where: { id: req.tenantId },
      data: { name, address, city },
    });

    return res.json({
      success: true,
      message: 'Nombre del residencial/condominio actualizado correctamente.',
      community,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar residencial', error: error.message });
  }
};

export const getDashboardStats = async (req: AuthRequest, res: Response) => {
  try {
    const totalResidents = await prisma.user.count({ where: { role: 'RESIDENT', ...tenantScope(req) } });
    const activeVisits = await prisma.visit.count({ where: { category: 'EN_CURSO', status: { in: ['INGRESADA', 'IN_PROGRESS'] }, exitDate: null, ...tenantScope(req) } });
    const pendingParcels = await prisma.parcel.count({ where: { status: 'PENDING', ...tenantScope(req) } });
    const openPqrs = await prisma.pqrs.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, ...tenantScope(req) } });
    const totalPendingPayments = await prisma.payment.aggregate({
      where: { status: 'PENDING', ...tenantScope(req) },
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
