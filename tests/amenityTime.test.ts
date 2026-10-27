import test from 'node:test';
import assert from 'node:assert/strict';
import { normEnd, reservationOverlaps, timeToMinutes as t } from '../src/utils/amenityTime.js';

// Reserva nueva el día D de 22:00 a 01:00 (cruza medianoche)
const start = t('22:00');
const end = normEnd(start, t('01:00'));

test('normEnd: sin cruce queda igual y con cruce suma 24 h', () => {
  assert.equal(normEnd(t('15:00'), t('17:00')), t('17:00'));
  assert.equal(end, 25 * 60);
});

test('sin cruce: mismo día se comporta como antes', () => {
  assert.equal(reservationOverlaps(t('15:00'), t('17:00'), { startTime: '16:00', endTime: '18:00' }, 0), true);
  assert.equal(reservationOverlaps(t('15:00'), t('17:00'), { startTime: '17:00', endTime: '18:00' }, 0), false);
});

test('22:00-01:00 vs 00:30-02:00 del día siguiente: conflicto', () => {
  assert.equal(reservationOverlaps(start, end, { startTime: '00:30', endTime: '02:00' }, 1), true);
});

test('22:00-01:00 vs 01:00-03:00 del día siguiente: libre', () => {
  assert.equal(reservationOverlaps(start, end, { startTime: '01:00', endTime: '03:00' }, 1), false);
});

test('reserva del día anterior que cruza medianoche ocupa el inicio del día', () => {
  // existente 23:00-01:00 el día anterior vs 00:30-02:00 hoy
  assert.equal(reservationOverlaps(t('00:30'), t('02:00'), { startTime: '23:00', endTime: '01:00' }, -1), true);
  assert.equal(reservationOverlaps(t('01:00'), t('02:00'), { startTime: '23:00', endTime: '01:00' }, -1), false);
});
