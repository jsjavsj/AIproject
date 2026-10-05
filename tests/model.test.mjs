import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, weekStart, todayInZone, occurrences, changeEvent, conflicts, layoutEvents } from '../src/model.js';

const series = () => ({ id: 'math', title: 'Math academy', category: 'academy', date: '2026-10-05', start: '15:00', end: '16:00', repeat: true, days: [1, 3], until: '2026-11-30', exceptions: {} });
const first = events => occurrences(events, '2026-10-05', '2026-10-05')[0];

test('weekly recurrence respects weekdays and inclusive range boundaries', () => {
  const result = occurrences([series()], '2026-10-01', '2026-10-14');
  assert.deepEqual(result.map(e => e.date), ['2026-10-05', '2026-10-07', '2026-10-12', '2026-10-14']);
  assert.equal(occurrences([series()], '2026-12-01', '2026-12-31').length, 0);
});
test('rescheduling one occurrence across weeks leaves its series unchanged', () => {
  const original = series();
  const events = changeEvent([original], first([original]), { ...original, date: '2026-10-17', start: '16:00', end: '17:00' }, 'one');
  assert.equal(occurrences(events, '2026-10-05', '2026-10-05').length, 0);
  assert.equal(occurrences(events, '2026-10-12', '2026-10-12')[0].start, '15:00');
  const moved = occurrences(events, '2026-10-17', '2026-10-17')[0];
  assert.equal(moved.originalDate, '2026-10-05');
  assert.equal(moved.start, '16:00');
  assert.equal(original.exceptions['2026-10-05'], undefined);
});
test('a moved occurrence can be edited again without duplicating it', () => {
  let events = [series()];
  events = changeEvent(events, first(events), { ...series(), date: '2026-10-09' }, 'one');
  const moved = occurrences(events, '2026-10-09', '2026-10-09')[0];
  events = changeEvent(events, moved, { ...series(), date: '2026-10-10' }, 'one');
  assert.equal(occurrences(events, '2026-10-09', '2026-10-09').length, 0);
  assert.equal(occurrences(events, '2026-10-10', '2026-10-10').length, 1);
});
test('editing future occurrences preserves past classes and splits the recurrence', () => {
  const events = [series()];
  const occurrence = occurrences(events, '2026-10-12', '2026-10-12')[0];
  const next = changeEvent(events, occurrence, { ...series(), date: occurrence.date, start: '17:00', end: '18:00' }, 'future');
  assert.equal(occurrences(next, '2026-10-05', '2026-10-05')[0].start, '15:00');
  assert.equal(occurrences(next, '2026-10-12', '2026-10-12')[0].start, '17:00');
  assert.equal(occurrences(next, '2026-10-14', '2026-10-14').length, 1);
});
test('entire-series time edit from a later week does not move the series start', () => {
  const events = [series()];
  const occurrence = occurrences(events, '2026-10-19', '2026-10-19')[0];
  const next = changeEvent(events, occurrence, { ...series(), date: occurrence.date, start: '12:00', end: '13:00' }, 'all');
  assert.equal(next[0].date, '2026-10-05');
  assert.equal(first(next).start, '12:00');
});
test('delete one, future, and all apply the selected recurrence scope', () => {
  const events = [series()], occurrence = occurrences(events, '2026-10-12', '2026-10-12')[0];
  const one = changeEvent(events, occurrence, {}, 'one', true);
  assert.equal(occurrences(one, '2026-10-12', '2026-10-12').length, 0);
  assert.equal(occurrences(one, '2026-10-14', '2026-10-14').length, 1);
  const future = changeEvent(events, occurrence, {}, 'future', true);
  assert.equal(first(future).title, 'Math academy');
  assert.equal(occurrences(future, '2026-10-12', '2026-11-30').length, 0);
  assert.equal(changeEvent(events, occurrence, {}, 'all', true).length, 0);
});
test('turning a series into a single event keeps the chosen event date', () => {
  const events = [series()];
  const occurrence = occurrences(events, '2026-10-19', '2026-10-19')[0];
  const next = changeEvent(events, occurrence, { ...series(), date: '2026-10-19', repeat: false }, 'all');
  assert.equal(next[0].date, '2026-10-19');
  assert.equal(occurrences(next, '2026-10-01', '2026-11-30').length, 1);
});
test('overlap detection includes partial containment but excludes adjacent sessions', () => {
  const a = { ...series(), repeat: false };
  const b = { ...a, id: 'b', start: '15:30', end: '16:30' };
  const c = { ...a, id: 'c', start: '16:30', end: '17:00' };
  assert.equal(conflicts([a, b, c], a.date, a.date).length, 1);
  const layout = layoutEvents([a, b, c]);
  assert.equal(layout[0].columns, 2);
  assert.equal(layout[1].column, 1);
  assert.equal(layout[2].columns, 1);
});
test('calendar arithmetic crosses month, leap year, and DST boundaries', () => {
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-08', 1), '2026-03-09');
  assert.equal(weekStart('2026-10-11'), '2026-10-05');
  assert.match(todayInZone('Asia/Seoul'), /^\d{4}-\d{2}-\d{2}$/);
});
