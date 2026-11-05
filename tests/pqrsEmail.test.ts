import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPqrsCreatedEmail } from '../src/services/email.service.js';

test('el correo de PQRS nueva escapa el HTML e incluye título, categoría y casa', () => {
  const { subject, html } = buildPqrsCreatedEmail({
    email: 'a@b.co',
    communityName: 'Villa <Sol>',
    title: '<b>Fuga</b>',
    category: 'QUEJA',
    unit: 'A 12',
  });
  assert.equal(subject, 'Nueva PQRS en Villa <Sol>');
  assert.ok(html.includes('&lt;b&gt;Fuga&lt;/b&gt;') && html.includes('QUEJA') && html.includes('A 12'));
  assert.ok(!html.includes('<b>Fuga'));
});
