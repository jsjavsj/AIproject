// Test-only init script. Never included in the production build.
(() => {
  const originalFetch = window.fetch.bind(window);
  window.__googleFixture = { status: 200, deleted: false, authorize: true };
  window.google = { accounts: { oauth2: {
    hasGrantedAllScopes: () => window.__googleFixture.authorize,
    initTokenClient: options => ({ requestAccessToken: () => setTimeout(() => options.callback({ access_token: 'TEST_ONLY_NOT_A_REAL_TOKEN', expires_in: 3600 }), 0) }),
  } } };
  window.fetch = async (input, options) => {
    const url = new URL(String(input), location.href), f = window.__googleFixture;
    if (!['www.googleapis.com', 'classroom.googleapis.com'].includes(url.hostname)) return originalFetch(input, options);
    if (f.status !== 200) return new Response('{}', { status: f.status });
    let body;
    if (url.pathname.endsWith('/userinfo')) body = { sub: 'fixture-account', email: 'student@example.test' };
    else if (url.pathname.endsWith('/calendarList')) body = { items: [{ id: 'primary', summary: 'Fixture school', primary: true }] };
    else if (url.pathname.endsWith('/events')) body = { items: f.deleted ? [] : [
      { id: 'class-one', summary: 'Imported science lesson', start: { dateTime: '2026-10-06T02:00:00Z' }, end: { dateTime: '2026-10-06T03:00:00Z' }, htmlLink: 'https://calendar.google.com/calendar/event?eid=test' },
      { id: 'holiday', summary: 'School holiday', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } },
    ] };
    else if (url.pathname.endsWith('/courses')) body = { courses: [{ id: 'course-one', name: 'Science 101' }] };
    else if (url.pathname.endsWith('/courseWork')) body = { courseWork: [{ id: 'hw-one', title: 'Imported chemistry worksheet', state: 'PUBLISHED', dueDate: { year: 2026, month: 10, day: 6 }, dueTime: { hours: 14, minutes: 59 }, alternateLink: 'https://classroom.google.com/c/test/a/test' }] };
    else return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
})();
