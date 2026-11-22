import test from 'node:test';
import assert from 'node:assert/strict';
import { settimanaDi, scadenza, dataBreve } from '../api/_settimana.js';

test('order week: Friday 16:00 Rome cut-off, summer and winter time', () => {
  const S = s => settimanaDi(new Date(s));
  assert.equal(S('2026-11-27T14:59:59Z'), '2026-11-27');
  assert.equal(S('2026-11-27T15:00:00Z'), '2026-12-04');
  assert.equal(S('2026-07-03T13:59:59Z'), '2026-07-03');
  assert.equal(S('2026-07-03T14:00:00Z'), '2026-07-10');
  assert.equal(S('2026-11-28T08:00:00Z'), '2026-12-04');
  assert.equal(S('2026-11-26T23:30:00Z'), '2026-11-27');
  assert.equal(S('2026-03-29T01:30:00Z'), '2026-04-03');
  assert.equal(S('2026-12-31T12:00:00Z'), '2027-01-01');
});

test('cut-off instant and short date', () => {
  assert.equal(scadenza('2026-11-27').toISOString(), '2026-11-27T15:00:00.000Z');
  assert.equal(scadenza('2026-07-03').toISOString(), '2026-07-03T14:00:00.000Z');
  assert.equal(scadenza('2026-10-23').toISOString(), '2026-10-23T14:00:00.000Z');
  assert.equal(scadenza('2026-10-30').toISOString(), '2026-10-30T15:00:00.000Z');
  assert.equal(dataBreve('2026-11-27'), '27/11');
});
