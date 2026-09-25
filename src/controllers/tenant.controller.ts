import { Response } from 'express';
import { prisma } from '../config/prisma.js';
import { AuthRequest } from '../middlewares/auth.middleware.js';
import { logAuditEvent } from '../services/audit.service.js';
import bcrypt from 'bcryptjs';

// List all tenants (Superadmin only)
export const listTenants = async (req: AuthRequest, res: Response) => {
  try {
    const tenants = await prisma.tenant.findMany({
      include: {
        settings: true,
        _count: {
          select: {
            houses: true,
            users: true,
            visits: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json({ success: true, tenants });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Create a new tenant with initial settings and optional residential admin (Superadmin)
export const createTenant = async (req: AuthRequest, res: Response) => {
  try {
    const { name, slug, address, city, phone, email, whatsapp, adminEmail, adminPassword, adminName } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: 'El nombre de la residencial es obligatorio.' });
    }

    const generatedSlug = slug || name.toLowerCase().replace(/[^a-z0-9]/g, '-');

    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug: generatedSlug,
        address,
        city: city || 'San Salvador',
        phone,
        email,
        whatsapp,
        settings: {
          create: {
            qrExpirationMinutes: 15,
            visitorMaxDurationHours: 4,
            deliveryEnabled: true,
            servicesEnabled: true,
            amenitiesEnabled: true,
            onlinePaymentsEnabled: true,
            pushNotificationsEnabled: true,
            whatsappEnabled: true,
            maintenanceEnabled: true,
            pqrsEnabled: true,
            defaultGraceDays: 3,
            defaultLateFeePercent: 5.0,
          },
        },
      },
      include: {
        settings: true,
      },
    });

    // If an initial residential admin was specified, create user
    if (adminEmail && adminPassword) {
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      await prisma.user.create({
        data: {
          email: adminEmail,
          password: hashedPassword,
          fullName: adminName || `Admin ${name}`,
          role: 'RESIDENTIAL_ADMIN',
          tenantId: tenant.id,
          phone,
        },
      });
    }

    await logAuditEvent({
      tenantId: tenant.id,
      userId: req.user?.id,
      action: 'CREATE_TENANT',
      entity: 'Tenant',
      entityId: tenant.id,
      details: { name, slug: generatedSlug },
      ipAddress: req.ip,
    });

    return res.status(201).json({
      success: true,
      message: 'Residencial creada exitosamente.',
      tenant,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Get current tenant information and settings
export const getCurrentTenant = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      // Fallback to first tenant or legacy community
      const fallback = await prisma.tenant.findFirst({
        include: { settings: true },
      });
      return res.json({ success: true, tenant: fallback });
    }

    let tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      include: { settings: true },
    });

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Residencial no encontrada.' });
    }

    // Ensure settings exist
    if (!tenant.settings) {
      const newSettings = await prisma.tenantSettings.create({
        data: { tenantId: tenant.id },
      });
      tenant = { ...tenant, settings: newSettings };
    }

    return res.json({ success: true, tenant });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Update current tenant basic information
export const updateCurrentTenant = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Identificador de residencial requerido.' });
    }

    const { name, address, city, phone, email, whatsapp, logoUrl } = req.body;

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(name && { name }),
        ...(address !== undefined && { address }),
        ...(city !== undefined && { city }),
        ...(phone !== undefined && { phone }),
        ...(email !== undefined && { email }),
        ...(whatsapp !== undefined && { whatsapp }),
        ...(logoUrl !== undefined && { logoUrl }),
      },
      include: { settings: true },
    });

    await logAuditEvent({
      tenantId,
      userId: req.user?.id,
      action: 'UPDATE_TENANT',
      entity: 'Tenant',
      entityId: tenantId,
      details: req.body,
      ipAddress: req.ip,
    });

    return res.json({ success: true, message: 'Configuración actualizada.', tenant: updated });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// Update tenant operational settings (QR expiration, late fee, feature toggles)
export const updateTenantSettings = async (req: AuthRequest, res: Response) => {
  try {
    const tenantId = req.tenantId;
    if (!tenantId) {
      return res.status(400).json({ success: false, message: 'Identificador de residencial requerido.' });
    }

    const {
      qrExpirationMinutes,
      visitorMaxDurationHours,
      deliveryEnabled,
      servicesEnabled,
      amenitiesEnabled,
      onlinePaymentsEnabled,
      pushNotificationsEnabled,
      whatsappEnabled,
      maintenanceEnabled,
      pqrsEnabled,
      defaultGraceDays,
      defaultLateFeePercent,
    } = req.body;

    const updatedSettings = await prisma.tenantSettings.upsert({
      where: { tenantId },
      create: {
        tenantId,
        ...(qrExpirationMinutes !== undefined && { qrExpirationMinutes }),
        ...(visitorMaxDurationHours !== undefined && { visitorMaxDurationHours }),
        ...(deliveryEnabled !== undefined && { deliveryEnabled }),
        ...(servicesEnabled !== undefined && { servicesEnabled }),
        ...(amenitiesEnabled !== undefined && { amenitiesEnabled }),
        ...(onlinePaymentsEnabled !== undefined && { onlinePaymentsEnabled }),
        ...(pushNotificationsEnabled !== undefined && { pushNotificationsEnabled }),
        ...(whatsappEnabled !== undefined && { whatsappEnabled }),
        ...(maintenanceEnabled !== undefined && { maintenanceEnabled }),
        ...(pqrsEnabled !== undefined && { pqrsEnabled }),
        ...(defaultGraceDays !== undefined && { defaultGraceDays }),
        ...(defaultLateFeePercent !== undefined && { defaultLateFeePercent }),
      },
      update: {
        ...(qrExpirationMinutes !== undefined && { qrExpirationMinutes }),
        ...(visitorMaxDurationHours !== undefined && { visitorMaxDurationHours }),
        ...(deliveryEnabled !== undefined && { deliveryEnabled }),
        ...(servicesEnabled !== undefined && { servicesEnabled }),
        ...(amenitiesEnabled !== undefined && { amenitiesEnabled }),
        ...(onlinePaymentsEnabled !== undefined && { onlinePaymentsEnabled }),
        ...(pushNotificationsEnabled !== undefined && { pushNotificationsEnabled }),
        ...(whatsappEnabled !== undefined && { whatsappEnabled }),
        ...(maintenanceEnabled !== undefined && { maintenanceEnabled }),
        ...(pqrsEnabled !== undefined && { pqrsEnabled }),
        ...(defaultGraceDays !== undefined && { defaultGraceDays }),
        ...(defaultLateFeePercent !== undefined && { defaultLateFeePercent }),
      },
    });

    await logAuditEvent({
      tenantId,
      userId: req.user?.id,
      action: 'UPDATE_TENANT_SETTINGS',
      entity: 'TenantSettings',
      entityId: updatedSettings.id,
      details: req.body,
      ipAddress: req.ip,
    });

    return res.json({
      success: true,
      message: 'Parámetros y reglas operativas actualizadas exitosamente.',
      settings: updatedSettings,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
