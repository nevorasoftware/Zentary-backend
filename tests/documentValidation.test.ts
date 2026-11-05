import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateDocumentInput } from '../src/utils/documentValidation.js';

test('acepta título y enlace https', () => {
  assert.deepEqual(validateDocumentInput(' Normas ', 'https://x.com/a.pdf'), { title: 'Normas', url: 'https://x.com/a.pdf' });
});
test('rechaza enlaces no https, javascript: y títulos inválidos', () => {
  assert.equal(typeof validateDocumentInput('A', 'http://x.com'), 'string');
  assert.equal(typeof validateDocumentInput('A', 'javascript:alert(1)'), 'string');
  assert.equal(typeof validateDocumentInput('', 'https://x.com'), 'string');
  assert.equal(typeof validateDocumentInput('a'.repeat(121), 'https://x.com'), 'string');
  assert.equal(typeof validateDocumentInput('A', 'https://x.com/' + 'a'.repeat(2000)), 'string');
});
