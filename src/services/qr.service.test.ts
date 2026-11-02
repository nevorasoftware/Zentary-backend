import test from 'node:test';
import assert from 'node:assert/strict';
import { remainingInRotationWindow } from './qr.service.js';

test('la ventana de rotación del QR es de 60 s', () => {
  assert.equal(remainingInRotationWindow(0), 60);
  assert.equal(remainingInRotationWindow(8000), 52);
  assert.ok(remainingInRotationWindow(60000) <= 0);
});
