import { test } from 'node:test';
import assert from 'node:assert/strict';
import visitRouter from './visit.routes.js';

const roleGuard = () => {
  const layer = (visitRouter as any).stack.find((l: any) => l.route?.path === '/:id/visitor-document');
  return layer.route.stack[0].handle;
};

const run = (role: string) => {
  let status = 0;
  let nextCalled = false;
  const res = {
    status(code: number) {
      status = code;
      return this;
    },
    json() {
      return this;
    },
  };
  roleGuard()({ user: { role } }, res, () => {
    nextCalled = true;
  });
  return { status, nextCalled };
};

test('un residente no puede consultar el documento de un visitante', () => {
  assert.deepEqual(run('RESIDENT'), { status: 403, nextCalled: false });
});

test('el personal de garita y administración sí puede', () => {
  for (const role of ['GUARD', 'SECURITY_ADMIN', 'RESIDENTIAL_ADMIN', 'ADMIN', 'SUPER_ADMIN']) {
    assert.deepEqual(run(role), { status: 0, nextCalled: true }, role);
  }
});
