import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarToEvents, courseworkToTasks, mergeImported, safeGoogleLink } from '../src/google-data.js';
import { GoogleConnection, validClientId } from '../src/google.js';
import { normalizeLayout } from '../src/preferences.js';
import { weekStart } from '../src/model.js';

const calendar = { id: 'primary@example.com', summary: 'School calendar' };
const convert = items => calendarToEvents(items, calendar, 'account-1', 'Asia/Seoul', '2026-10-01', '2026-10-31');
test('Google event times are converted to the planner zone', () => {
  const [event] = convert([{ id: 'one', summary: 'Math', start: { dateTime: '2026-10-05T01:00:00Z' }, end: { dateTime: '2026-10-05T02:30:00Z' } }]);
  assert.equal(event.date, '2026-10-05'); assert.equal(event.start, '10:00'); assert.equal(event.end, '11:30');
  assert.equal(event.remote.container, calendar.id); assert.equal(event.remote.account, 'account-1');
});
test('all-day imports use the exclusive Google end date', () => {
  const events = convert([{ id: 'holiday', start: { date: '2026-10-05' }, end: { date: '2026-10-07' } }]);
  assert.deepEqual(events.map(e => e.date), ['2026-10-05', '2026-10-06']);
  assert.ok(events.every(e => e.allDay));
});
test('overnight events split into daily segments without empty midnight segments', () => {
  const events = convert([{ id: 'late', start: { dateTime: '2026-10-05T23:00:00+09:00' }, end: { dateTime: '2026-10-07T00:00:00+09:00' } }]);
  assert.equal(events.length, 2); assert.equal(events[0].start, '23:00'); assert.equal(events[1].date, '2026-10-06');
});
test('cancelled events are omitted and long events are clipped to the import window', () => {
  const events = convert([{ id: 'gone', status: 'cancelled' }, { id: 'long', start: { date: '2026-09-01' }, end: { date: '2026-11-02' } }]);
  assert.equal(events.length, 31); assert.equal(events[0].date, '2026-10-01'); assert.equal(events.at(-1).date, '2026-10-31');
});
test('assignment UTC deadline crosses to the correct local date', () => {
  const [task] = courseworkToTasks([{ id: 'hw', title: 'Chemistry', dueDate: { year: 2026, month: 10, day: 5 }, dueTime: { hours: 23, minutes: 59 } }], { id: 'c1', name: 'Science' }, 'a1', 'Asia/Seoul');
  assert.equal(task.deadline, '2026-10-06'); assert.equal(task.deadlineTime, '08:59'); assert.equal(task.done, false);
});
test('assignments without deadlines remain unscheduled and drafts are excluded', () => {
  const tasks = courseworkToTasks([{ id: '1', title: 'Reading', state: 'PUBLISHED' }, { id: '2', state: 'DRAFT' }], { id: 'c', name: 'English' }, 'a', 'UTC');
  assert.equal(tasks.length, 1); assert.equal(tasks[0].deadline, '');
});
test('refresh keeps task identity, study-session links, completion, and estimates', () => {
  const [task] = courseworkToTasks([{ id: 'hw', title: 'Before' }], { id: 'c', name: 'Science' }, 'a', 'UTC');
  task.done = true; task.duration = 90; task.priority = 'high';
  const incoming = { ...task, id: 'new-id', title: 'After', done: false, duration: 60, priority: 'medium' };
  const local = { id: 'local', title: 'Local task' };
  const merged = mergeImported([task, local], [incoming, incoming], 'classroom');
  assert.equal(merged.length, 2); assert.equal(merged[1].id, task.id); assert.equal(merged[1].title, 'After');
  assert.equal(merged[1].done, true); assert.equal(merged[1].duration, 90); assert.equal(merged[1].priority, 'high');
});
test('sync replaces deleted or deselected imports while preserving personal events', () => {
  const [event] = convert([{ id: 'one', start: { date: '2026-10-05' }, end: { date: '2026-10-06' } }]);
  assert.deepEqual(mergeImported([event, { id: 'personal' }], [], 'calendar'), [{ id: 'personal' }]);
});
test('account changes cannot inherit another account’s completion', () => {
  const [task] = courseworkToTasks([{ id: 'hw' }], { id: 'c' }, 'a', 'UTC'); task.done = true;
  const [incoming] = courseworkToTasks([{ id: 'hw' }], { id: 'c' }, 'b', 'UTC');
  assert.equal(mergeImported([task], [incoming], 'classroom')[0].done, false);
});
test('source links reject script URLs and lookalike hosts', () => {
  assert.equal(safeGoogleLink('javascript:alert(1)', 'calendar'), '');
  assert.equal(safeGoogleLink('https://classroom.google.com.evil.test/a', 'classroom'), '');
  assert.equal(safeGoogleLink('https://classroom.google.com/c/123', 'classroom'), 'https://classroom.google.com/c/123');
});
function connection(fetcher) {
  const api = new GoogleConnection({ fetcher, now: () => 100 });
  api.sessions.calendar = { token: 'test-only-token', expires: 1000, account: { id: 'a' } };
  return api;
}
test('Google pagination preserves query parameters and authenticates every page', async () => {
  const requests = [];
  const api = connection(async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => requests.length === 1 ? { items: [{ id: 1 }], nextPageToken: 'next-page' } : { items: [{ id: 2 }] } }; });
  assert.equal((await api.listCalendars()).length, 2);
  assert.equal(new URL(requests[1].url).searchParams.get('maxResults'), '250');
  assert.equal(new URL(requests[1].url).searchParams.get('pageToken'), 'next-page');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-only-token');
});
test('expired sessions fail before any network request', async () => {
  const api = connection(() => { throw Error('Should not fetch'); }); api.sessions.calendar.expires = 99;
  await assert.rejects(api.listCalendars(), /expired/);
});
test('401 clears session; 403 and quota errors produce actionable messages', async () => {
  const unauthorized = connection(async () => ({ status: 401, ok: false }));
  await assert.rejects(unauthorized.listCalendars(), /expired/); assert.equal(unauthorized.connected('calendar'), false);
  await assert.rejects(connection(async () => ({ status: 403, ok: false })).listCalendars(), /Google Calendar API: Google denied access.*HTTP_403/);
  await assert.rejects(connection(async () => ({ status: 429, ok: false })).listCalendars(), /Wait/);
});
test('a failed later page rejects the entire import instead of returning partial data', async () => {
  let calls = 0;
  const api = connection(async () => ++calls === 1 ? { ok: true, json: async () => ({ items: [{ id: 'first' }], nextPageToken: 'more' }) } : { ok: false, status: 500 });
  await assert.rejects(api.listCalendars(), /Existing imports are unchanged/);
});
test('partial Google consent is rejected', async () => {
  const previous = globalThis.google;
  globalThis.google = { accounts: { oauth2: { initTokenClient: options => ({ requestAccessToken: () => options.callback({ access_token: 'test', expires_in: 3600, scope: 'openid email' }) }) } } };
  try { await assert.rejects(new GoogleConnection().connect('calendar', '123-test.apps.googleusercontent.com'), /Missing Google permissions: calendar.calendarlist.readonly, calendar.events.readonly/); }
  finally { globalThis.google = previous; }
});
test('client configuration accepts only public client IDs', () => {
  assert.equal(validClientId('123-test.apps.googleusercontent.com'), true); assert.equal(validClientId('GOCSPX-secret'), false);
});
test('one Google sign-in grants both services to the same verified account', async () => {
  const previous = globalThis.google; let requestedScope = '', popups = 0;
  globalThis.google = { accounts: { oauth2: {
    initTokenClient: options => { requestedScope = options.scope; return { requestAccessToken: () => { popups++; options.callback({ access_token: 'fixture', expires_in: 3600, scope: options.scope }); } }; },
  } } };
  try {
    const api = new GoogleConnection({ fetcher: async () => ({ ok: true, json: async () => ({ sub: 'student-a', email: 'student@example.test' }) }) });
    await api.connect('all', '123-fixture.apps.googleusercontent.com');
    assert.equal(popups, 1); assert.equal(api.account('calendar').id, 'student-a'); assert.equal(api.account('classroom').id, 'student-a');
    assert.equal(api.sessions.calendar, api.sessions.classroom);
    assert.ok(requestedScope.includes('classroom.courses.readonly'));
  } finally { globalThis.google = previous; }
});
test('declining combined permissions cannot establish a partially connected new account', async () => {
  const previous = globalThis.google;
  globalThis.google = { accounts: { oauth2: { initTokenClient: options => ({ requestAccessToken: () => options.callback({ access_token: 'denied', expires_in: 3600, scope: 'openid email' }) }) } } };
  try {
    const api = new GoogleConnection();
    await assert.rejects(api.connect('all', '123-fixture.apps.googleusercontent.com'), /Missing Google permissions/);
    assert.equal(api.connected('calendar'), false); assert.equal(api.connected('classroom'), false);
  } finally { globalThis.google = previous; }
});
test('layout preferences are validated and Sunday weeks cross month boundaries', () => {
  assert.deepEqual(normalizeLayout(null), normalizeLayout());
  assert.equal(normalizeLayout({ accent: 'invalid', density: 'compact', showTasks: false }).accent, 'indigo');
  assert.equal(normalizeLayout({ density: 'compact' }).density, 'compact');
  assert.equal(weekStart('2026-10-01', 0), '2026-09-27');
  assert.equal(weekStart('2026-10-01', 1), '2026-09-28');
});
