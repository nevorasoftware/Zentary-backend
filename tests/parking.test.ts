import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHoldWindow, computeZoneOccupancy, pickZone, windowsOverlap } from '../src/utils/parking.js';

const T = (iso: string) => new Date(iso);
const now = T('2026-10-23T15:00:00Z');

test('ventana de reserva: 30 min antes y minutos de espera después', () => {
  const w = computeHoldWindow(T('2026-10-23T16:00:00Z'), 45);
  assert.equal(w.holdFrom.toISOString(), '2026-10-23T15:30:00.000Z');
  assert.equal(w.holdUntil.toISOString(), '2026-10-23T16:45:00.000Z');
  assert.equal(computeHoldWindow(T('2026-10-23T16:00:00Z')).holdUntil.toISOString(), '2026-10-23T17:00:00.000Z');
});

test('solapamiento de ventanas', () => {
  assert.equal(windowsOverlap(T('2026-10-23T10:00:00Z'), T('2026-10-23T11:00:00Z'), T('2026-10-23T11:00:00Z'), T('2026-10-23T12:00:00Z')), false);
  assert.equal(windowsOverlap(T('2026-10-23T10:00:00Z'), T('2026-10-23T11:01:00Z'), T('2026-10-23T11:00:00Z'), T('2026-10-23T12:00:00Z')), true);
});

test('ocupación: cuenta OCUPADO y RESERVADO solapadas; ignora vencidas, otras zonas y estados finales', () => {
  const w = computeHoldWindow(now);
  const rs = [
    { zoneId: 'a', status: 'OCUPADO', holdFrom: T('2026-10-23T13:00:00Z'), holdUntil: T('2026-10-23T14:00:00Z') },
    { zoneId: 'a', status: 'RESERVADO', holdFrom: T('2026-10-23T14:45:00Z'), holdUntil: T('2026-10-23T16:00:00Z') },
    { zoneId: 'a', status: 'RESERVADO', holdFrom: T('2026-10-23T13:00:00Z'), holdUntil: T('2026-10-23T14:00:00Z') }, // vencida
    { zoneId: 'a', status: 'LIBERADO', holdFrom: T('2026-10-23T14:45:00Z'), holdUntil: T('2026-10-23T16:00:00Z') },
    { zoneId: 'b', status: 'OCUPADO', holdFrom: T('2026-10-23T14:45:00Z'), holdUntil: T('2026-10-23T16:00:00Z') },
  ];
  assert.equal(computeZoneOccupancy(rs, 'a', w, now), 2);
  assert.equal(computeZoneOccupancy(rs, 'b', w, now), 1);
});

test('visita de mañana no reduce libres de hoy, y los ocupados de hoy no bloquean mañana', () => {
  const tomorrow = computeHoldWindow(T('2026-10-24T15:00:00Z'));
  const rs = [
    { zoneId: 'a', status: 'RESERVADO', holdFrom: tomorrow.holdFrom, holdUntil: tomorrow.holdUntil },
    { zoneId: 'a', status: 'OCUPADO', holdFrom: T('2026-10-23T14:00:00Z'), holdUntil: T('2026-10-23T15:00:00Z') },
  ];
  assert.equal(computeZoneOccupancy(rs, 'a', computeHoldWindow(now), now), 1);
  assert.equal(computeZoneOccupancy(rs, 'a', tomorrow, now), 1);
});

test('selección automática: primera zona activa por orden con espacio', () => {
  const w = computeHoldWindow(now);
  const zones = [
    { id: 'c', capacity: 1, isActive: true, sortOrder: 2 },
    { id: 'a', capacity: 1, isActive: true, sortOrder: 0 },
    { id: 'x', capacity: 5, isActive: false, sortOrder: 1 },
  ];
  const full = [{ zoneId: 'a', status: 'RESERVADO', holdFrom: w.holdFrom, holdUntil: w.holdUntil }];
  assert.equal(pickZone(zones, [], w, now)?.id, 'a');
  assert.equal(pickZone(zones, full, w, now)?.id, 'c');
  assert.equal(pickZone(zones, [...full, { zoneId: 'c', status: 'OCUPADO', holdFrom: w.holdFrom, holdUntil: w.holdUntil }], w, now), null);
});
