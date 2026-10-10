// Test-only init script. Never included in the production build.
(() => {
  const originalFetch = window.fetch.bind(window);
  window.__googleFixture = { status: 200, deleted: false, authorize: true };
  window.google = { accounts: { oauth2: {
    initTokenClient: options => ({ requestAccessToken: () => { window.__googleFixture.signIns = (window.__googleFixture.signIns || 0) + 1; window.__googleFixture.scopes = options.scope; let granted = options.scope.replace('https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.readonly').replace('https://www.googleapis.com/auth/calendar.events.readonly', ''); if (window.__googleFixture.omitCoursework) granted = granted.replace('https://www.googleapis.com/auth/classroom.coursework.me.readonly', ''); setTimeout(() => options.callback({ access_token: 'TEST_ONLY_NOT_A_REAL_TOKEN', expires_in: 3600, scope: window.__googleFixture.authorize ? granted : 'openid email' }), 0); } }),
  } } };
  window.fetch = async (input, options) => {
    const url = new URL(String(input), location.href), f = window.__googleFixture;
    if (!['www.googleapis.com', 'classroom.googleapis.com'].includes(url.hostname)) return originalFetch(input, options);
    if (f.status !== 200) return new Response(JSON.stringify(f.errorBody || {}), { status: f.status });
    if (f.failMaterials && url.pathname.endsWith('/courseWorkMaterials')) return new Response('{}', { status: 403 });
    if (f.failCoursework && url.pathname.endsWith('/courseWork')) return new Response(JSON.stringify({ error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } }), { status: 403 });
    let body;
    if (url.pathname.endsWith('/userinfo')) body = { sub: f.accountId || 'fixture-account', email: f.email || 'student@example.test' };
    else if (url.pathname.endsWith('/calendarList')) body = { items: [{ id: 'primary', summary: 'Fixture school', primary: true }] };
    else if (url.pathname.endsWith('/events')) body = { items: f.deleted ? [] : [
      { id: 'class-one', summary: 'Imported science lesson', start: { dateTime: '2026-10-06T02:00:00Z' }, end: { dateTime: '2026-10-06T03:00:00Z' }, htmlLink: 'https://calendar.google.com/calendar/event?eid=test' },
      { id: 'holiday', summary: 'School holiday', start: { date: '2026-10-07' }, end: { date: '2026-10-08' } },
    ] };
    else if (url.pathname.endsWith('/courses')) body = { courses: [{ id: 'course-one', name: 'Science 101' }] };
    else if (url.pathname.endsWith('/courseWork')) body = { courseWork: [{ id: 'hw-one', title: 'Imported chemistry worksheet', state: 'PUBLISHED', dueDate: { year: 2026, month: 10, day: 6 }, dueTime: { hours: 14, minutes: 59 }, alternateLink: 'https://classroom.google.com/c/test/a/test', materials: [{ driveFile: { driveFile: { title: 'Chemistry worksheet.pdf', alternateLink: 'https://drive.google.com/file/d/fixture/view' } } }] }] };
    else if (url.pathname.endsWith('/announcements')) body = { announcements: f.deletedPosts ? [] : [{ id: 'announcement-one', text: 'Bring your lab coat tomorrow.\nWe will meet in Room 3. <script>window.bad=true</script>', state: 'PUBLISHED', updateTime: '2026-10-06T04:00:00Z', alternateLink: 'https://classroom.google.com/c/test/p/notice' }] };
    else if (url.pathname.endsWith('/courseWorkMaterials')) body = { courseWorkMaterial: f.deletedPosts ? [] : [{ id: 'material-one', title: 'This week’s study resources', description: 'Review the lesson and complete the practice quiz before class.', state: 'PUBLISHED', updateTime: '2026-10-05T06:00:00Z', alternateLink: 'https://classroom.google.com/c/test/m/material', materials: [{ link: { title: 'Study guide', url: 'https://school.example/study' } }, { youtubeVideo: { title: 'Atoms and molecules', alternateLink: 'https://www.youtube.com/watch?v=fixture' } }, { form: { title: 'Practice quiz', formUrl: 'https://docs.google.com/forms/d/fixture/viewform' } }] }] };
    else return new Response('{}', { status: 404 });
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
})();
