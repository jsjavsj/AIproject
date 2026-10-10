import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleConnection } from '../src/google.js';
import { SCOPES } from '../src/google-data.js';
import { t, setLanguage } from '../src/i18n.js';

function denied(body) {
  return { ok: false, status: 403, json: async () => body };
}
function apiFor(response) {
  const api = new GoogleConnection({ fetcher: async () => response });
  api.sessions.calendar = { token: 'fixture-only', expires: Date.now() + 60000 };
  return api;
}

test('disabled APIs identify the OAuth project rather than asking for consent again', async () => {
  for (const body of [
    { error: { details: [{ reason: 'SERVICE_DISABLED', metadata: { service: 'calendar-json.googleapis.com' } }] } },
    { error: { errors: [{ reason: 'accessNotConfigured' }] } },
    { error: { message: 'Calendar API has not been used in project 123 before or it is disabled.' } },
  ]) {
    await assert.rejects(apiFor(denied(body)).listCalendars(), /Google Calendar API: Enable this API.*same project as your OAuth client ID/);
  }
});

test('scope errors, quota errors and account restrictions give different recovery steps', async () => {
  const cases = [
    ['ACCESS_TOKEN_SCOPE_INSUFFICIENT', /Reconnect Google and approve/],
    ['insufficientPermissions', /Reconnect Google and approve/],
    ['rateLimitExceeded', /request limit/],
    ['userRateLimitExceeded', /request limit/],
    ['quotaExceeded', /request limit/],
    ['domainPolicy', /account or its organization/],
  ];
  for (const [reason, expected] of cases) {
    await assert.rejects(apiFor(denied({ error: { errors: [{ reason }] } })).listCalendars(), expected);
  }
  await assert.rejects(apiFor(denied({ error: { message: '@ClassroomApiDisabled The user is not permitted to access the Classroom API.' } })).listCalendars(), /account or its organization.*ClassroomApiDisabled/);
  await assert.rejects(apiFor(denied({ error: { message: 'Request had insufficient authentication scopes.' } })).listCalendars(), /ACCESS_TOKEN_SCOPE_INSUFFICIENT/);
});

test('unknown and malformed 403 responses stay readable without exposing raw response data', async () => {
  for (const response of [
    { ok: false, status: 403, json: async () => { throw Error('not JSON'); } },
    denied({ error: { details: {}, errors: null, message: '<script>private data</script>' } }),
    denied({ error: { details: [null, { reason: '<script>private data</script>' }], message: 'fixture-only' } }),
  ]) {
    await assert.rejects(apiFor(response).listCalendars(), error => {
      assert.match(error.message, /Google denied access.*HTTP_403/);
      assert.ok(!error.message.includes('private data') && !error.message.includes('fixture-only'));
      return true;
    });
  }
  await assert.rejects(apiFor(denied({ error: { errors: [{ reason: 'newGoogleReason' }] } })).listCalendars(), /\[newGoogleReason\]/);
});

test('a failed page rejects the full import with the specific Google reason and keeps the session', async () => {
  const api = apiFor(null); let calls = 0;
  api.fetcher = async () => ++calls === 1
    ? { ok: true, json: async () => ({ items: [{ id: 'first' }], nextPageToken: 'more' }) }
    : denied({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } });
  await assert.rejects(api.listCalendars(), /SERVICE_DISABLED/);
  assert.equal(api.connected('calendar'), true);
});

test('Classroom API failure during consent verification preserves its reason and Calendar access', async () => {
  const previous = globalThis.google;
  const scope = [...SCOPES.calendar, ...SCOPES.classroom.filter(value => !value.endsWith('coursework.me.readonly'))].join(' ');
  globalThis.google = { accounts: { oauth2: { initTokenClient: options => ({ requestAccessToken: () => options.callback({ access_token: 'fixture-only', expires_in: 3600, scope }) }) } } };
  try {
    for (const failCourses of [true, false]) {
      const api = new GoogleConnection({ fetcher: async url => {
        if (url.includes('/userinfo')) return { ok: true, json: async () => ({ sub: 'student' }) };
        if (!failCourses && url.includes('/courses?')) return { ok: true, json: async () => ({ courses: [{ id: 'course' }] }) };
        return denied({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } });
      } });
      await api.connect('all', '123-fixture.apps.googleusercontent.com');
      assert.equal(api.connected('calendar'), true);
      assert.equal(api.connected('classroom'), false);
      assert.match(api.permissionError('classroom'), /Google Classroom API: Enable this API.*SERVICE_DISABLED/);
      assert.equal(api.permissionError('calendar'), '');
      await assert.rejects(api.connect('classroom', '123-fixture.apps.googleusercontent.com'), /SERVICE_DISABLED/);
    }
  } finally { globalThis.google = previous; }
});

test('Google diagnostics translate to Korean without changing the service or reason code', async () => {
  globalThis.document = { documentElement: {}, title: '' };
  try {
    setLanguage('ko');
    try { await apiFor(denied({ error: { details: [{ reason: 'SERVICE_DISABLED' }] } })).listCalendars(); }
    catch (error) {
      const translated = t(error.message);
      assert.match(translated, /동일한 프로젝트/);
      assert.match(translated, /^Google Calendar API:.*\[SERVICE_DISABLED\]$/);
      setLanguage('en');
      assert.equal(t(error.message), error.message);
    }
  } finally { delete globalThis.document; }
});
