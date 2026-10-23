import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, detectDelimiter, escapeFormula, unescapeFormula, csvCell, toCsv } from '../src/utils/csv.js';

test('parsea filas simples con coma', () => {
  assert.deepEqual(parseCsv('a,b,c\n1,2,3'), [['a', 'b', 'c'], ['1', '2', '3']]);
});

test('autodetecta punto y coma', () => {
  assert.equal(detectDelimiter('a;b;c\n1,2;3'), ';');
  assert.deepEqual(parseCsv('a;b\r\n1;2\r\n'), [['a', 'b'], ['1', '2']]);
});

test('ignora el BOM UTF-8', () => {
  assert.deepEqual(parseCsv('﻿codigo,bloque\nA-1,B'), [['codigo', 'bloque'], ['A-1', 'B']]);
});

test('comillas RFC 4180: separador, salto de línea y comillas dobles dentro del campo', () => {
  assert.deepEqual(parseCsv('a,"b,c","d ""x""\nlinea"\n'), [['a', 'b,c', 'd "x"\nlinea']]);
});

test('conserva celdas vacías y omite filas vacías', () => {
  assert.deepEqual(parseCsv('a,,c\n\n,,\n1,2,3'), [['a', '', 'c'], ['', '', ''], ['1', '2', '3']]);
});

test('comillas sin cerrar lanza error', () => {
  assert.throws(() => parseCsv('a,"b\nc'), /comillas/);
});

test('escapa celdas que empiezan con = + - @', () => {
  for (const v of ['=1+1', '+503 7777', '-5', '@SUM(A1)', '\tx']) {
    assert.equal(escapeFormula(v), `'${v}`);
  }
  assert.equal(escapeFormula('A-1'), 'A-1');
  assert.equal(escapeFormula(''), '');
});

test('unescapeFormula es la inversa de escapeFormula', () => {
  for (const v of ['=1+1', '+503 7777', '-5', '@x', "'normal", 'A-1']) {
    assert.equal(unescapeFormula(escapeFormula(v)), v);
  }
});

test('csvCell aplica comillas y escape de fórmulas', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('=cmd|x'), "'=cmd|x");
  assert.equal(csvCell(null), '');
});

test('toCsv y parseCsv hacen ida y vuelta', () => {
  const rows = [['codigo', 'nombre'], ['A-1', 'Ana "la" Pérez, Jr.'], ['A-2', '']];
  assert.deepEqual(parseCsv(toCsv(rows)), rows);
});
