import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { sendPushNotificationToMultiple } from '../services/pushNotification.service.js';
import { logAuditEvent } from '../services/audit.service.js';

// Helper to resolve tenantId across headers, token, user record or fallback
const resolveTenantId = async (req: AuthRequest): Promise<string | undefined> => {
  if (req.tenantId) return req.tenantId;
  if (req.user?.tenantId) return req.user.tenantId;
  const headerTenant = req.headers['x-tenant-id'] as string;
  if (headerTenant) return headerTenant;
  if (req.user?.id) {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { tenantId: true, communityId: true },
    });
    if (user?.tenantId) return user.tenantId;
    if (user?.communityId) return user.communityId;
  }
  const defaultTenant = await prisma.tenant.findFirst({ select: { id: true } });
  return defaultTenant?.id;
};

/**
 * GET /api/announcements
 * Obtener todos los comunicados vigentes para la residencial
 */
export const getAnnouncements = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = await resolveTenantId(req);

    const where: any = {};
    if (tenantId) {
      where.OR = [{ tenantId }, { communityId: tenantId }];
    }

    const announcements = await prisma.announcement.findMany({
      where,
      include: {
        author: {
          select: { id: true, fullName: true, avatarUrl: true },
        },
      },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });

    return res.json({ success: true, announcements });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al obtener anuncios', error: error.message });
  }
};

/**
 * POST /api/announcements
 * Publicar un nuevo comunicado oficial con segmentación y notificaciones
 */
export const createAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.id;
    const tenantId = await resolveTenantId(req);

    const {
      title,
      body,
      category = 'GENERAL',
      priority = 'NORMAL',
      targetAudience = 'TODOS',
      targetBlock,
      imageUrl,
      fileUrl,
      expiresAt,
    } = req.body;

    if (!userId) return res.status(401).json({ success: false, message: 'No autenticado.' });
    if (!title || !body) {
      return res.status(400).json({ success: false, message: 'Título y contenido requeridos.' });
    }

    const parsedExpiresAt = expiresAt ? new Date(expiresAt) : null;

    const announcement = await prisma.announcement.create({
      data: {
        tenantId,
        communityId: tenantId,
        title: title.trim(),
        body: body.trim(),
        category,
        priority: priority.toUpperCase(),
        targetAudience: targetAudience.toUpperCase(),
        targetBlock: targetBlock || null,
        imageUrl: imageUrl || null,
        fileUrl: fileUrl || null,
        expiresAt: parsedExpiresAt,
        authorId: userId,
      },
      include: {
        author: { select: { id: true, fullName: true } },
      },
    });

    // Envío de notificaciones push segmentadas a residentes
    try {
      const residentWhere: any = {
        role: 'RESIDENT',
        pushToken: { not: null },
        ...(tenantId ? { OR: [{ tenantId }, { communityId: tenantId }] } : {}),
      };

      if (targetAudience === 'BLOQUE' && targetBlock) {
        residentWhere.OR = [
          { house: { block: targetBlock } },
          { property: { block: targetBlock } },
        ];
      }

      const residents = await prisma.user.findMany({
        where: residentWhere,
        select: { pushToken: true },
      });

      const tokens = residents.map((r) => r.pushToken);
      const icon = priority === 'URGENTE' ? '🚨' : priority === 'IMPORTANTE' ? '⚠️' : '📢';
      sendPushNotificationToMultiple(tokens, `${icon} ${title}`, body.substring(0, 150), {
        type: 'ANNOUNCEMENT',
        id: announcement.id,
      });
    } catch (pushErr) {
      console.error('[createAnnouncement Push Error]:', pushErr);
    }

    if (tenantId) {
      await logAuditEvent({
        tenantId,
        userId,
        action: 'CREATE_ANNOUNCEMENT',
        entity: 'ANNOUNCEMENT',
        entityId: announcement.id,
        details: { title, priority, targetAudience },
        result: 'SUCCESS',
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Anuncio publicado exitosamente',
      announcement,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al publicar anuncio', error: error.message });
  }
};

/**
 * PUT /api/announcements/:id
 * Actualizar comunicado existente
 */
export const updateAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { title, body, category, priority, targetAudience, targetBlock, imageUrl, fileUrl, expiresAt } = req.body;

    const existing = await prisma.announcement.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ success: false, message: 'Comunicado no encontrado' });

    const updated = await prisma.announcement.update({
      where: { id },
      data: {
        title: title !== undefined ? title.trim() : existing.title,
        body: body !== undefined ? body.trim() : existing.body,
        category: category !== undefined ? category : existing.category,
        priority: priority !== undefined ? priority.toUpperCase() : existing.priority,
        targetAudience: targetAudience !== undefined ? targetAudience.toUpperCase() : existing.targetAudience,
        targetBlock: targetBlock !== undefined ? targetBlock : existing.targetBlock,
        imageUrl: imageUrl !== undefined ? imageUrl : existing.imageUrl,
        fileUrl: fileUrl !== undefined ? fileUrl : existing.fileUrl,
        expiresAt: expiresAt !== undefined ? (expiresAt ? new Date(expiresAt) : null) : existing.expiresAt,
      },
      include: {
        author: { select: { id: true, fullName: true } },
      },
    });

    return res.json({ success: true, message: 'Comunicado actualizado correctamente', announcement: updated });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al actualizar anuncio', error: error.message });
  }
};

/**
 * DELETE /api/announcements/:id
 * Eliminar comunicado
 */
export const deleteAnnouncement = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    await prisma.announcement.delete({ where: { id } });

    return res.json({ success: true, message: 'Anuncio eliminado correctamente' });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: 'Error al eliminar anuncio', error: error.message });
  }
};
