import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVisitInvitationEmail, isValidEmail } from './email.service.js';

test('isValidEmail acepta correos válidos y rechaza inválidos', () => {
  assert.equal(isValidEmail('juan@correo.com'), true);
  assert.equal(isValidEmail('juan@correo'), false);
  assert.equal(isValidEmail('juan perez@correo.com'), false);
  assert.equal(isValidEmail('sin-arroba.com'), false);
});

test('buildVisitInvitationEmail incluye enlace, residencial y escapa HTML', () => {
  const { subject, text, html } = buildVisitInvitationEmail({
    email: 'a@b.co',
    residentName: 'Ana <b>',
    communityName: 'Residencial Sol',
    unit: 'A 12',
    validFromText: '28/10/2026 10:00',
    publicUrl: 'https://x.test/visit/abc',
  });
  assert.equal(subject, 'Tu pase de ingreso a Residencial Sol');
  assert.ok(text.includes('https://x.test/visit/abc'));
  assert.ok(html.includes('https://x.test/visit/abc'));
  assert.ok(html.includes('Ana &lt;b&gt;'));
});
