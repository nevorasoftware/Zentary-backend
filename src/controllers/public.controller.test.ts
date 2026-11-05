import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { renderHtml } from './public.controller.js';

const XSS = `"><img src=x onerror=alert(1)></script><script>alert(2)</script>'`;

const scriptOf = (html: string) => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'la carga no debe abrir ni cerrar etiquetas <script>');
  return scripts[0][1];
};

// Ejecuta el script de la página con un DOM mínimo y devuelve el valor de publicToken
const runScript = (script: string) => {
  const element: any = new Proxy(function () {}, {
    get: (_t, key) => (key === 'style' || key === 'classList' ? element : key === Symbol.toPrimitive ? () => '' : element),
    apply: () => element,
    set: () => true,
  });
  const context: any = { document: { getElementById: () => element, querySelector: () => element }, setInterval: () => 1, clearInterval: () => {} };
  vm.runInNewContext(`${script};globalThis.__token = publicToken;`, context);
  return context.__token;
};

test('el token malicioso no ejecuta código y conserva su valor en el script', () => {
  const html = renderHtml({ publicToken: XSS, errorTitle: 'Invitación No Encontrada', errorDesc: 'x' });
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('alert(2)</script>'));
  assert.equal(runScript(scriptOf(html)), XSS);
});

test('un token que intenta cerrar el literal no inyecta instrucciones', () => {
  const payload = '";globalThis.__pwned=1;//';
  const script = scriptOf(renderHtml({ publicToken: payload, errorTitle: 'x', errorDesc: 'y' }));
  const context: any = { document: { getElementById: () => ({ addEventListener() {} }) } };
  vm.runInNewContext(`${script};globalThis.__token = publicToken;`, context);
  assert.equal(context.__pwned, undefined);
  assert.equal(context.__token, payload);
});

test('el literal conserva tokens con 2028 y separadores de línea', () => {
  const lineSeparator = String.fromCharCode(0x2028);
  for (const token of ['abc2028def2029', 'a' + lineSeparator + 'b']) {
    const html = renderHtml({ publicToken: token, errorTitle: 'x', errorDesc: 'y' });
    assert.equal(runScript(scriptOf(html)), token);
    assert.ok(!scriptOf(html).includes(lineSeparator));
  }
});

test('visitorName y communityName se escapan en el formulario y en la pantalla del QR', () => {
  const html = renderHtml({
    publicToken: 'abc',
    visitStatus: 'DATOS_COMPLETADOS',
    visitorName: XSS,
    communityName: XSS,
    communityAddress: XSS,
    propertyUnit: XSS,
    formattedDateStr: XSS,
  });
  assert.ok(!html.includes('<img src=x'));
  assert.equal([...html.matchAll(/<script>/g)].length, 1);
  assert.ok(html.includes('value="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;'));
  assert.ok(html.includes('<h2 class="community-title">&quot;&gt;&lt;img'));
});

test('un nombre legítimo se muestra igual después de escaparse', () => {
  const html = renderHtml({ publicToken: 'abc', visitorName: "O'Brien & Hijos", communityName: 'Sol' });
  assert.ok(html.includes('value="O&#39;Brien &amp; Hijos"'));
});

test('el flujo de la página solo usa campos que la API sigue enviando', () => {
  const script = scriptOf(renderHtml({ publicToken: 'abc' }));
  const used = new Set([...script.matchAll(/\bdata\.(\w+)/g)].map((m) => m[1]));
  assert.deepEqual([...used].sort(), ['code', 'message', 'qrImageDataUrl', 'remainingSeconds', 'success']);
});
