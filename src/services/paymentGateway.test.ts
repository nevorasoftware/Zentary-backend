import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'crypto';
import { decryptSecret, encryptSecret, getEncryptionKey } from '../utils/secretCipher.js';
import {
  pickWompiCredentials,
  isValidWompiWebhookHash,
  WompiUnavailableError,
  type WompiCredentials,
} from './wompi.service.js';
import { gatewayBodySchema, toGatewayView } from '../controllers/paymentGateway.controller.js';
import tenantRouter from '../routes/tenant.routes.js';

const key = randomBytes(32);
const company: WompiCredentials = { clientId: 'empresa-id', clientSecret: 'empresa-secreto', source: 'company' };

test('cifrado: ida y vuelta', () => {
  const enc = encryptSecret('super-secreto-123', 'tenant-1', key);
  assert.ok(enc.startsWith('v1:'));
  assert.ok(!enc.includes('super-secreto-123'));
  assert.equal(decryptSecret(enc, 'tenant-1', key), 'super-secreto-123');
});

test('cifrado: AAD distinto o clave distinta fallan', () => {
  const enc = encryptSecret('super-secreto-123', 'tenant-1', key);
  assert.throws(() => decryptSecret(enc, 'tenant-2', key));
  assert.throws(() => decryptSecret(enc, 'tenant-1', randomBytes(32)));
});

test('cifrado: clave ausente o de longitud inválida', () => {
  assert.equal(getEncryptionKey(''), null);
  assert.equal(getEncryptionKey(undefined), null);
  assert.equal(getEncryptionKey('abc'), null);
  assert.equal(getEncryptionKey(randomBytes(32).toString('hex'))?.length, 32);
  assert.equal(getEncryptionKey(randomBytes(32).toString('base64'))?.length, 32);
  assert.throws(() => encryptSecret('x', 'tenant-1', null));
});

test('HMAC del webhook con secreto por parámetro', () => {
  const body = Buffer.from('{"IdTransaccion":"abc"}');
  const hash = createHmac('sha256', 'secreto-tenant').update(body).digest('hex');
  assert.equal(isValidWompiWebhookHash(body, hash, 'secreto-tenant'), true);
  assert.equal(isValidWompiWebhookHash(body, hash, 'otro'), false);
  assert.equal(isValidWompiWebhookHash(body, hash, undefined), false);
  assert.equal(isValidWompiWebhookHash(undefined, hash, 'secreto-tenant'), false);
});

const rowOf = (enabled: boolean, aad = 't1') => ({
  tenantId: 't1',
  clientId: 'tenant-id',
  clientSecretEnc: encryptSecret('secreto-del-tenant', aad, key),
  enabled,
});
const dec = (p: string, a: string) => decryptSecret(p, a, key);

test('resolución: sin fila usa la empresa', () => {
  assert.equal(pickWompiCredentials(null, { forNewCharge: true }, company, dec).source, 'company');
});

test('resolución: fila activa usa las del tenant', () => {
  const c = pickWompiCredentials(rowOf(true), { forNewCharge: true }, company, dec);
  assert.equal(c.source, 'tenant');
  assert.equal(c.clientSecret, 'secreto-del-tenant');
});

test('resolución: enabled=false va a la empresa en cobros nuevos y al tenant en verificación', () => {
  assert.equal(pickWompiCredentials(rowOf(false), { forNewCharge: true }, company, dec).source, 'company');
  assert.equal(pickWompiCredentials(rowOf(false), { forNewCharge: false }, company, dec).source, 'tenant');
});

test('resolución: fila indescifrable o clave ausente es fallo cerrado', () => {
  assert.throws(() => pickWompiCredentials(rowOf(true, 'otro-aad'), { forNewCharge: true }, company, dec), WompiUnavailableError);
  const noKey = (p: string, a: string) => decryptSecret(p, a, null);
  assert.throws(() => pickWompiCredentials(rowOf(true), { forNewCharge: false }, company, noKey), WompiUnavailableError);
});

test('resolución: sin fila y sin credenciales de empresa falla', () => {
  assert.throws(() => pickWompiCredentials(null, {}, null, dec), WompiUnavailableError);
});

test('GET nunca incluye el secreto', () => {
  const view = toGatewayView({ clientId: 'x', enabled: true, lastTestAt: null, lastTestOk: null });
  assert.equal(view.hasSecret, true);
  const json = JSON.stringify({ view, row: toGatewayView(null, 'empresa-id') });
  assert.ok(!/secret/i.test(json.replace(/hasSecret/g, '')));
});

test('zod: validación del cuerpo', () => {
  const ok = { clientId: 'abc', clientSecret: '12345678', enabled: true };
  assert.equal(gatewayBodySchema.safeParse(ok).success, true);
  assert.equal(gatewayBodySchema.safeParse({ ...ok, clientId: 'a b' }).success, false);
  assert.equal(gatewayBodySchema.safeParse({ ...ok, clientId: '' }).success, false);
  assert.equal(gatewayBodySchema.safeParse({ ...ok, clientSecret: '1234567' }).success, false);
  assert.equal(gatewayBodySchema.safeParse({ ...ok, clientSecret: 'x'.repeat(501) }).success, false);
  assert.equal(gatewayBodySchema.safeParse({ clientId: 'abc', clientSecret: '12345678' }).success, false);
});

test('roles: RESIDENTIAL_ADMIN recibe 403 en PUT, DELETE y test; GET lo permite', () => {
  const stack: any[] = (tenantRouter as any).stack;
  const run = (method: string, path: string, role: string) => {
    const layer = stack.find((l) => l.route?.path === path && l.route.methods[method]);
    assert.ok(layer, `ruta ${method} ${path}`);
    // El segundo handler es requireRole (el primero es authenticateToken)
    const roleGuard = layer.route.stack[1].handle;
    let status = 200;
    let passed = false;
    const res: any = { status: (s: number) => ((status = s), res), json: () => res };
    roleGuard({ user: { role } }, res, () => (passed = true));
    return { status, passed };
  };
  for (const [m, p] of [['put', '/current/payment-gateway'], ['delete', '/current/payment-gateway'], ['post', '/current/payment-gateway/test']]) {
    assert.equal(run(m, p, 'RESIDENTIAL_ADMIN').status, 403);
    assert.equal(run(m, p, 'SUPER_ADMIN').passed, true);
  }
  assert.equal(run('get', '/current/payment-gateway', 'RESIDENTIAL_ADMIN').passed, true);
});
