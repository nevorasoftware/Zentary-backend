import { Response } from 'express';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { sendTenantCredentialsEmail } from '../services/email.service.js';
import { sendWhatsAppMessage } from '../services/whatsapp.service.js';

const tenantScope = (req: AuthRequest) => (req.tenantId ? { tenantId: req.tenantId } : {});

// Convención: Community.id === Tenant.id. Devuelve (o crea) el Community de la residencial.
export const resolveCommunityForTenant = async (tenantId: string) => {
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

export const normalizeUnit = (v: unknown) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : '');
// Contraseña inicial aleatoria (sin caracteres ambiguos: 0 O 1 l I)
export const generateInitialPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length: 10 }, () => chars[randomInt(chars.length)]).join('');
};
export const normalizeBlock = (v: unknown) => { const b = typeof v === 'string' ? v.trim() : ''; return b ? b : null; };

export const findOrCreateHouse = async (tenantId: string, unitNumber: string, block: string | null) => {
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

    const sanitizedUsers = users.map(({ password, pushToken, documentType, documentNumber, whatsapp, ...u }) => u);
    return res.json({ success: true, users: sanitizedUsers });
  } catch (error: any) {
    console.error('Error al obtener usuarios:', error?.code || error?.name);
    return res.status(500).json({ success: false, message: 'Error al obtener usuarios' });
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

    const { password, pushToken, documentType, documentNumber, whatsapp, ...sanitizedUser } = user;
    return res.json({
      success: true,
      message: `Acceso del usuario ${isActive ? 'activado' : 'desactivado'} con éxito.`,
      user: sanitizedUser,
    });
  } catch (error: any) {
    console.error('Error al actualizar acceso de usuario:', error?.code || error?.name);
    return res.status(500).json({ success: false, message: 'Error al actualizar acceso de usuario' });
  }
};

/**
 * Libera la vivienda de un residente (cambio de residente / dueño).
 * Desactiva al anterior, cancela sus pases pendientes y accesos frecuentes y
 * registra el cambio. El historial (visitas, pagos, PQRS) no se modifica.
 */
export const releaseResident = async (req: AuthRequest, res: Response) => {
  try {
    const { userId } = req.params;
    const { newUserId, newOwner, reason } = req.body || {};
    const tenantId = req.tenantId as string;
    if (!tenantId) {
      return res.status(400).json({ success: false, code: 'TENANT_REQUIRED', message: 'Selecciona una residencial.' });
    }

    const previous = await prisma.user.findFirst({ where: { id: userId, role: 'RESIDENT', tenantId } });
    if (!previous) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    let newUser = null;
    if (newUserId) {
      newUser = await prisma.user.findFirst({ where: { id: newUserId, role: 'RESIDENT', tenantId } });
      if (!newUser || newUser.id === previous.id) {
        return res.status(404).json({ success: false, message: 'Nuevo residente no encontrado.' });
      }
    }

    // Idempotente: si ya fue liberado, no se repite nada
    if (!previous.isActive && !previous.houseId) {
      return res.json({ success: true, message: 'El residente ya había sido dado de baja.', alreadyReleased: true });
    }

    const ownerName = typeof newOwner?.name === 'string' ? newOwner.name.trim() : '';
    const ownerPhone = typeof newOwner?.phone === 'string' ? newOwner.phone.trim() : '';
    const ownerEmail = typeof newOwner?.email === 'string' ? newOwner.email.trim().toLowerCase() : '';

    const cancelledVisits = await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: previous.id }, data: { isActive: false, houseId: null } });
      await tx.vehicle.updateMany({ where: { residentId: previous.id, tenantId }, data: { isActive: false } });

      // Pases pendientes y accesos frecuentes (no se tocan los que ya ingresaron o terminaron)
      const toCancel = await tx.visit.findMany({
        where: {
          residentId: previous.id,
          OR: [{ status: { in: ['PENDIENTE_REGISTRO', 'DATOS_COMPLETADOS'] } }, { category: 'FRECUENTE' }],
          NOT: { status: { in: ['CANCELADA', 'INGRESADA', 'IN_PROGRESS', 'COMPLETED', 'VENCIDA'] } },
        },
        select: { id: true },
      });
      const ids = toCancel.map((v) => v.id);
      if (ids.length) {
        await tx.visit.updateMany({ where: { id: { in: ids } }, data: { status: 'CANCELADA' } });
        await tx.visitToken.updateMany({ where: { visitId: { in: ids } }, data: { isRevoked: true } });
      }

      if (previous.houseId) {
        if (newOwner && ownerName) {
          await tx.house.updateMany({
            where: { id: previous.houseId, tenantId },
            data: { ownerName, ownerPhone: ownerPhone || null, ownerEmail: ownerEmail || null },
          });
        }
        await tx.houseOccupancyLog.create({
          data: {
            tenantId,
            houseId: previous.houseId,
            previousUserId: previous.id,
            newUserId: newUser?.id ?? null,
            reason: typeof reason === 'string' && reason.trim() ? reason.trim() : null,
            performedBy: req.user?.id ?? null,
          },
        });
      }
      return ids.length;
    });

    return res.json({
      success: true,
      message: 'Residente dado de baja y vivienda liberada.',
      cancelledVisits,
    });
  } catch (error: any) {
    console.error('Error al liberar vivienda:', error?.code || error?.name);
    return res.status(500).json({ success: false, message: 'Error al cambiar de residente' });
  }
};

/**
 * Registra un nuevo inquilino en la residencial especificada,
 * genera su usuario con contraseña genérica y marca mustChangePassword: true.
 */
export const registerTenant = async (req: AuthRequest, res: Response) => {
  try {
    const { fullName, unitNumber, block, email, phone, communityId, communityName, houseId: selectedHouseId } = req.body;

    if (!fullName || (!unitNumber && !selectedHouseId) || !email) {
      return res.status(400).json({
        success: false,
        message: 'Nombre completo, número de unidad y correo electrónico son requeridos.',
      });
    }

    let unit = normalizeUnit(unitNumber);
    let blk = normalizeBlock(block);
    if (!req.tenantId) {
      return res.status(400).json({ success: false, message: 'Residencial no resuelta.' });
    }

    // Si se indica una vivienda existente, la unidad y el bloque salen de ahí
    let selectedHouse = null;
    if (selectedHouseId) {
      selectedHouse = await prisma.house.findFirst({ where: { id: selectedHouseId, tenantId: req.tenantId } });
      if (!selectedHouse) {
        return res.status(404).json({ success: false, message: 'Vivienda no encontrada.' });
      }
      unit = selectedHouse.unitNumber;
      blk = selectedHouse.block;
    }
    if (!unit) {
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

    const house = selectedHouse ?? await findOrCreateHouse(req.tenantId, unit, blk);

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

    const { password, pushToken, documentType, documentNumber, whatsapp, ...sanitizedUser } = newTenant;

    // Trigger automatic WhatsApp Cloud API message if phone is available
    let whatsappApiSent = false;
    if (cleanPhone) {
      try {
        console.log(`[WHATSAPP API] 📲 Enviando credenciales automáticas por WhatsApp...`);
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
      console.error('Email dispatch error:', err?.message, err?.code);
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
    console.error('Error al registrar inquilino:', error?.code || error?.name);
    return res.status(500).json({ success: false, message: 'Error al registrar inquilino' });
  }
};

/**
 * Editar datos del inquilino (Nombre, correo, teléfono, unidad)
 */
export const updateTenant = async (req: AuthRequest, res: Response) => {
  try {
    const { tenantId } = req.params;
    const { fullName, email, phone, unitNumber, block, houseId: selectedHouseId } = req.body;

    const user = await prisma.user.findFirst({
      where: { id: tenantId, role: { in: ['RESIDENT', 'GUARD'] }, ...tenantScope(req) },
      include: { property: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    if (email && email.trim() !== '' && email !== user.email) {
      const emailTaken = await prisma.user.findFirst({
        where: { email: { equals: email.trim(), mode: 'insensitive' }, id: { not: user.id } },
        select: { id: true },
      });
      if (emailTaken) {
        return res.status(409).json({ success: false, message: 'No se pudo actualizar el correo.' });
      }
    }

    let finalUnit = normalizeUnit(unitNumber) || user.property?.unitNumber;
    let finalBlock = block !== undefined ? normalizeBlock(block) : (user.property?.block ?? null);

    // Si se indica una vivienda existente, la unidad y el bloque salen de ahí
    let selectedHouse = null;
    if (selectedHouseId) {
      const selectedTenantId = user.tenantId || req.tenantId;
      if (!selectedTenantId) {
        return res.status(400).json({ success: false, message: 'Residencial no resuelta.' });
      }
      selectedHouse = await prisma.house.findFirst({
        where: { id: selectedHouseId, tenantId: selectedTenantId },
      });
      if (!selectedHouse) {
        return res.status(404).json({ success: false, message: 'Vivienda no encontrada.' });
      }
      finalUnit = selectedHouse.unitNumber;
      finalBlock = selectedHouse.block;
    }

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
      const house = selectedHouse ?? await findOrCreateHouse(houseTenantId, finalUnit, finalBlock);
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

    const { password, pushToken, documentType, documentNumber, whatsapp, ...sanitizedUser } = updatedUser;
    return res.json({
      success: true,
      message: 'Información del inquilino actualizada correctamente.',
      tenant: sanitizedUser,
    });
  } catch (error: any) {
    if (error?.code === 'P2002') {
      return res.status(409).json({ success: false, message: 'No se pudo actualizar el correo.' });
    }
    console.error('Error al actualizar inquilino:', error?.code || error?.name);
    return res.status(500).json({ success: false, message: 'Error al actualizar inquilino' });
  }
};

/**
 * Reenviar credenciales por correo mediante Gmail API
 */
export const resendTenantCredentials = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, unitNumber, block, communityName } = req.body;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Se requiere el usuario.' });
    }

    const user = await prisma.user.findFirst({
      where: { id: userId, role: { in: ['RESIDENT', 'GUARD'] }, ...tenantScope(req) },
      include: { property: true, community: true },
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
    }

    const targetEmail = user.email;
    const targetName = user.fullName;
    const targetUnit = user.property?.unitNumber || unitNumber;
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
        console.log(`[WHATSAPP API] 📲 Reenviando credenciales por WhatsApp Cloud API...`);
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
    console.error('Error al reenviar credenciales:', error?.code || error?.name);
    return res.status(500).json({ success: false, message: 'Error al reenviar credenciales' });
  }
};

/**
 * Enviar credenciales por la API Oficial de Meta WhatsApp Cloud directamente desde el servidor
 */
export const sendWhatsAppCredentials = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, communityName } = req.body;

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

    const phone = user.phone;
    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, message: 'El usuario no tiene teléfono registrado; edítalo primero.' });
    }
    const fullName = user.fullName;
    const email = user.email;

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

    console.log(`[WHATSAPP CLOUD API] 📱 Enviando accesos vía Meta Cloud API...`);
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
    console.error('Error al enviar mensaje por WhatsApp API:', error?.code || error?.name);
    return res.status(500).json({ success: false, message: 'Error al enviar mensaje por WhatsApp API' });
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
    console.error('Error al obtener residencial:', error?.code || error?.name);
    return res.status(500).json({ success: false, message: 'Error al obtener residencial' });
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
    console.error('Error al actualizar residencial:', error?.code || error?.name);
    return res.status(500).json({ success: false, message: 'Error al actualizar residencial' });
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
    console.error('Error al obtener estadísticas:', error?.code || error?.name);
    return res.status(500).json({ success: false, message: 'Error al obtener estadísticas' });
  }
};
