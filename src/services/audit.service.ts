import { prisma } from '../config/prisma.js';

export interface AuditLogParams {
  tenantId: string;
  userId?: string;
  action: string;
  entity: string;
  entityId?: string;
  details?: any;
  ipAddress?: string;
  result?: 'SUCCESS' | 'FAILURE' | 'REJECTED';
}

export const logAuditEvent = async (params: AuditLogParams) => {
  try {
    const stringifiedDetails =
      typeof params.details === 'object' ? JSON.stringify(params.details) : params.details;

    await prisma.auditLog.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        action: params.action,
        entity: params.entity,
        entityId: params.entityId,
        details: stringifiedDetails,
        ipAddress: params.ipAddress,
        result: params.result || 'SUCCESS',
      },
    });
  } catch (error) {
    console.error('⚠️ [AuditLog Error]:', error);
  }
};
