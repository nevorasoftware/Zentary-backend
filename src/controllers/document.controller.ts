import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { validateDocumentInput } from '../utils/documentValidation.js';

const tenantRequired = (res: Response) =>
  res.status(400).json({
    success: false,
    code: 'TENANT_REQUIRED',
    message: 'Operación denegada: Identificador de residencial requerido',
  });

/**
 * GET /api/documents
 * Documentos publicados por la residencial del usuario
 */
export const getDocuments = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.tenantId) return tenantRequired(res);
    const documents = await prisma.tenantDocument.findMany({
      where: { tenantId: req.tenantId },
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ success: true, documents });
  } catch (error: any) {
    console.error('getDocuments:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error al obtener documentos' });
  }
};

/**
 * POST /api/documents
 * Publicar un documento (título + enlace) para la residencial
 */
export const createDocument = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.tenantId) return tenantRequired(res);
    const input = validateDocumentInput(req.body?.title, req.body?.url);
    if (typeof input === 'string') return res.status(400).json({ success: false, message: input });

    const document = await prisma.tenantDocument.create({ data: { tenantId: req.tenantId, ...input } });
    return res.status(201).json({ success: true, message: 'Documento publicado', document });
  } catch (error: any) {
    console.error('createDocument:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error al publicar documento' });
  }
};

/**
 * DELETE /api/documents/:id
 * Eliminar un documento de la residencial del usuario
 */
export const deleteDocument = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const existing = await prisma.tenantDocument.findUnique({ where: { id }, select: { tenantId: true } });
    if (!existing || (req.user?.role !== 'SUPER_ADMIN' && existing.tenantId !== req.tenantId)) {
      return res.status(404).json({ success: false, message: 'Documento no encontrado' });
    }

    await prisma.tenantDocument.delete({ where: { id } });
    return res.json({ success: true, message: 'Documento eliminado' });
  } catch (error: any) {
    console.error('deleteDocument:', error?.message, error?.code);
    return res.status(500).json({ success: false, message: 'Error al eliminar documento' });
  }
};
