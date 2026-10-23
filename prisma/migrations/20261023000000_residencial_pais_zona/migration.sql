-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'El Salvador',
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/El_Salvador';

