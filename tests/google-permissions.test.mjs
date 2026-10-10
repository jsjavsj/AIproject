import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleConnection, missingGoogleScopes } from '../src/google.js';
import { SCOPES } from '../src/google-data.js';
const auth = 'https://www.googleapis.com/auth/';
const required = [...SCOPES.calendar, ...SCOPES.classroom];

test('exact granted permissions accept arbitrary whitespace and ordering', () => {
  assert.deepEqual(missingGoogleScopes({ scope: ` openid\n${[...required].reverse().join('  ')} email ` }, required), []);
});
test('broader Calendar grants cover both requested read operations', () => {
  for (const scope of ['calendar.readonly', 'calendar']) {
    assert.deepEqual(missingGoogleScopes({ scope: auth + scope }, SCOPES.calendar), []);
  }
});
test('broader Classroom grants cover read access without requesting write permission', () => {
  const scope = SCOPES.classroom.map(value => value.replace(/\.readonly$/, '')).join(' ');
  assert.deepEqual(missingGoogleScopes({ scope }, SCOPES.classroom), []);
  assert.ok(required.every(value => value.endsWith('.readonly')));
});
test('restricted Calendar subsets and teacher-only Classroom access do not pass', () => {
  for (const scope of ['calendar.events.freebusy', 'calendar.events.owned.readonly', 'calendar.events.public.readonly', 'calendar.app.created']) {
    assert.deepEqual(missingGoogleScopes({ scope: auth + scope }, SCOPES.calendar), SCOPES.calendar);
  }
  const ownWork = [auth + 'classroom.coursework.me.readonly'];
  assert.deepEqual(missingGoogleScopes({ scope: auth + 'classroom.coursework.students.readonly' }, ownWork), ownWork);
});
test('a genuine missing grant is identified without blaming both services', () => {
  const missing = auth + 'classroom.announcements.readonly';
  assert.deepEqual(missingGoogleScopes({ scope: required.filter(value => value !== missing).join(' ') }, required), [missing]);
});
test('broader OAuth response connects, requests renewed consent and uses one account', async () => {
  const previous = globalThis.google; let override, requested, calls = 0;
  globalThis.google = { accounts: { oauth2: {
    initTokenClient: options => {
      requested = options.scope;
      return { requestAccessToken: value => { override = value; options.callback({ access_token: 'fixture-only', expires_in: 3600, scope: [auth + 'calendar.readonly', ...SCOPES.classroom, 'openid', 'email'].join(' ') }); } };
    },
  } } };
  try {
    const api = new GoogleConnection({ fetcher: async (url, options) => {
      calls++; assert.equal(url, 'https://www.googleapis.com/oauth2/v3/userinfo');
      assert.equal(options.headers.Authorization, 'Bearer fixture-only');
      return { ok: true, json: async () => ({ sub: 'student-a' }) };
    } });
    await api.connect('all', '123-fixture.apps.googleusercontent.com');
    assert.equal(calls, 1); assert.equal(override.prompt, 'consent select_account');
    assert.equal(api.account('calendar').id, api.account('classroom').id);
    assert.ok(required.every(scope => requested.includes(scope)));
    assert.ok(!requested.split(' ').includes(auth + 'calendar'));
  } finally { globalThis.google = previous; }
});
test('incomplete OAuth responses reject before fetching or establishing a session', async () => {
  const previous = globalThis.google;
  try {
    for (const response of [{}, { access_token: 'fixture-only', expires_in: 3600 }, { access_token: 'fixture-only', expires_in: 'bad', scope: required.join(' ') }]) {
      globalThis.google = { accounts: { oauth2: { initTokenClient: options => ({ requestAccessToken: () => options.callback(response) }) } } };
      const api = new GoogleConnection({ fetcher: () => { throw Error('Must not fetch'); } });
      await assert.rejects(api.connect('all', '123-fixture.apps.googleusercontent.com'), /incomplete sign-in response/);
      assert.equal(api.connected('calendar'), false); assert.equal(api.connected('classroom'), false);
    }
  } finally { globalThis.google = previous; }
});

async function withMissingCoursework(run) {
  const previous = globalThis.google;
  const scope = required.filter(value => value !== auth + 'classroom.coursework.me.readonly').join(' ');
  globalThis.google = { accounts: { oauth2: { initTokenClient: options => ({ requestAccessToken: () => options.callback({ access_token: 'fixture-only', expires_in: 3600, scope }) }) } } };
  try { await run(); } finally { globalThis.google = previous; }
}
test('missing assignment scope is accepted only after Google confirms an actual coursework read', async () => withMissingCoursework(async () => {
  const requests = [];
  const api = new GoogleConnection({ fetcher: async (url, options) => {
    requests.push(url); assert.equal(options.headers.Authorization, 'Bearer fixture-only');
    if (url.includes('/userinfo')) return { ok: true, json: async () => ({ sub: 'student-a' }) };
    if (url.includes('/courses?')) return { ok: true, json: async () => ({ courses: [{ id: 'c/1' }] }) };
    assert.ok(url.includes('/courses/c%2F1/courseWork?'));
    assert.equal(new URL(url).searchParams.get('fields'), 'courseWork(id)');
    return { ok: true, json: async () => ({}) };
  } });
  await api.connect('all', '123-fixture.apps.googleusercontent.com');
  assert.equal(requests.length, 3);
  assert.ok(api.connected('calendar')); assert.ok(api.connected('classroom'));
  assert.equal(api.permissionError('classroom'), '');
}));
test('Google refusing assignments does not block Calendar or leave the old Classroom account connected', async () => withMissingCoursework(async () => {
  const api = new GoogleConnection({ fetcher: async url => {
    if (url.includes('/userinfo')) return { ok: true, json: async () => ({ sub: 'new-account' }) };
    if (url.includes('/courses?')) return { ok: true, json: async () => ({ courses: [{ id: 'c1' }] }) };
    return { ok: false, status: 403 };
  } });
  api.sessions.classroom = { token: 'old-fixture', expires: Date.now() + 100000, account: { id: 'old-account' } };
  await api.connect('all', '123-fixture.apps.googleusercontent.com');
  assert.equal(api.account('calendar').id, 'new-account');
  assert.equal(api.connected('classroom'), false);
  assert.match(api.permissionError('classroom'), /Google Classroom API: Google denied access.*HTTP_403/);
  assert.equal(api.permissionError('calendar'), '');
  api.disconnect('classroom'); assert.equal(api.permissionError('classroom'), '');
}));
test('empty courses and network failure cannot be mistaken for assignment authorization', async () => withMissingCoursework(async () => {
  for (const fail of [false, true]) {
    const api = new GoogleConnection({ fetcher: async url => {
      if (url.includes('/userinfo')) return { ok: true, json: async () => ({ sub: 'student-a' }) };
      if (fail) throw Error('offline');
      return { ok: true, json: async () => ({ courses: [] }) };
    } });
    await api.connect('all', '123-fixture.apps.googleusercontent.com');
    assert.ok(api.connected('calendar')); assert.equal(api.connected('classroom'), false);
  }
}));
