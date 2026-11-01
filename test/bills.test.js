import assert from 'node:assert/strict';
import test from 'node:test';

import { monthLabel, parseMonth, shiftMonth } from '../site/js/bills.js';

test('parseMonth valida e cai no mês atual', () => {
  assert.equal(parseMonth('2026-02'), '2026-02');
  assert.equal(parseMonth('2026-13', new Date('2026-09-26T12:00:00Z')), '2026-09');
  assert.equal(parseMonth(undefined, new Date('2026-10-01T02:00:00Z')), '2026-09');
});

test('shiftMonth atravessa anos', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('monthLabel escreve o mês por extenso', () => {
  assert.equal(monthLabel('2026-09'), 'Setembro de 2026');
});
