import test from 'node:test';
import assert from 'node:assert/strict';
import { prisma } from '../src/config/prisma.js';
import { getTenantTimezone, invalidateTenantTimezone, zonedToUtc } from '../src/utils/timezone.js';

test('caché de zona horaria: la segunda llamada no consulta Prisma y la actualización invalida', async () => {
  let calls = 0;
  let tz = 'America/Bogota';
  (prisma.tenant as any).findUnique = async () => { calls++; return { timezone: tz }; };

  assert.equal(await getTenantTimezone('t-cache'), 'America/Bogota');
  assert.equal(await getTenantTimezone('t-cache'), 'America/Bogota');
  assert.equal(calls, 1);

  tz = 'America/Mexico_City';
  invalidateTenantTimezone('t-cache');
  assert.equal(await getTenantTimezone('t-cache'), 'America/Mexico_City');
  assert.equal(calls, 2);
});

test('la misma hora 08:00 guarda instantes distintos según la zona de la residencial', () => {
  const bogota = zonedToUtc(2026, 10, 28, 8, 0, 'America/Bogota');
  const mexico = zonedToUtc(2026, 10, 28, 8, 0, 'America/Mexico_City');
  assert.equal(bogota.toISOString(), '2026-10-28T13:00:00.000Z');
  assert.equal(mexico.toISOString(), '2026-10-28T14:00:00.000Z');
});
