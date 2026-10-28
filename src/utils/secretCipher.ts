/**
 * Cifrado de secretos en reposo (AES-256-GCM).
 * Formato almacenado: v1:iv:tag:ct (base64). El tenantId se usa como AAD.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/** Devuelve la clave de 32 bytes (hex de 64 caracteres o base64) o null si falta o es inválida */
export const getEncryptionKey = (raw: string | undefined = process.env.CREDENTIALS_ENCRYPTION_KEY): Buffer | null => {
  const value = raw?.trim();
  if (!value) return null;
  if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, 'hex');
  const buf = Buffer.from(value, 'base64');
  return buf.length === 32 ? buf : null;
};

export const isEncryptionKeyConfigured = (): boolean => getEncryptionKey() !== null;

export const encryptSecret = (plain: string, aad: string, key: Buffer | null = getEncryptionKey()): string => {
  if (!key) throw new Error('CREDENTIALS_ENCRYPTION_KEY no configurada.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ['v1', iv.toString('base64'), tag.toString('base64'), ct.toString('base64')].join(':');
};

export const decryptSecret = (payload: string, aad: string, key: Buffer | null = getEncryptionKey()): string => {
  if (!key) throw new Error('CREDENTIALS_ENCRYPTION_KEY no configurada.');
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Formato de secreto cifrado no válido.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
};
