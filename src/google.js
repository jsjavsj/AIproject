import { SCOPES } from './google-data.js';

export const validClientId = value => /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);
const AUTH = 'https://www.googleapis.com/auth/';
// A prior grant may cover a requested read scope under a broader name.
// Only accept alternatives that cover the same data (not owned/public/freebusy subsets).
// Sources: Calendar and Classroom REST discovery documents, methods.list.scopes.
const coveringScopes = {
  'calendar.calendarlist.readonly': ['calendar.calendarlist', 'calendar.readonly', 'calendar'],
  'calendar.events.readonly': ['calendar.events', 'calendar.readonly', 'calendar'],
  'classroom.courses.readonly': ['classroom.courses'],
  'classroom.coursework.me.readonly': ['classroom.coursework.me'],
  'classroom.announcements.readonly': ['classroom.announcements'],
  'classroom.courseworkmaterials.readonly': ['classroom.courseworkmaterials'],
};
export function missingGoogleScopes(response, required) {
  const granted = new Set(typeof response?.scope === 'string' ? response.scope.trim().split(/\s+/) : []);
  return required.filter(scope => ![scope, ...(coveringScopes[scope.slice(AUTH.length)] || []).map(value => AUTH + value)].some(value => granted.has(value)));
}
const permissionMessage = missing => `Missing Google permissions: ${missing.map(scope => scope.slice(AUTH.length)).join(', ')}. Reconnect and approve these permissions. If already approved, check your school’s app-access policy.`;
async function deniedAccessError(service, response) {
  let error;
  try { error = (await response.json())?.error; } catch { /* Google may return a non-JSON error. */ }
  const message = typeof error?.message === 'string' ? error.message : '';
  const details = Array.isArray(error?.details) ? error.details : [];
  const legacy = Array.isArray(error?.errors) ? error.errors : [];
  // Display only bounded reason codes, never raw responses, URLs, or account data.
  const reasons = [...details.map(item => item?.reason), ...legacy.map(item => item?.reason), message.match(/^@([A-Za-z][A-Za-z0-9_]{0,79}) /)?.[1]]
    .filter(value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(value));
  let reason = reasons[0] || 'HTTP_403';
  let guidance = 'Google denied access to this data. Check that the connected account can open it in Google, then reconnect. Share this error code if it continues.';
  const matches = values => values.find(value => reasons.includes(value));
  let matched;
  if ((matched = matches(['SERVICE_DISABLED', 'accessNotConfigured'])) || /has not been used in project .+ before or it is disabled/i.test(message)) {
    reason = matched || 'SERVICE_DISABLED';
    guidance = 'Enable this API in Google Cloud Console → APIs & Services → Library, in the same project as your OAuth client ID. Wait a few minutes, then retry.';
  } else if ((matched = matches(['ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'insufficientPermissions'])) || /insufficient authentication scopes/i.test(message)) {
    reason = matched || 'ACCESS_TOKEN_SCOPE_INSUFFICIENT';
    guidance = 'Google did not grant the read permission needed for this request. Reconnect Google and approve all requested permissions. The website owner should check Google Auth Platform → Data Access.';
  } else if ((matched = matches(['RATE_LIMIT_EXCEEDED', 'QUOTA_EXCEEDED', 'rateLimitExceeded', 'userRateLimitExceeded', 'quotaExceeded', 'dailyLimitExceeded']))) {
    reason = matched;
    guidance = 'Google has reached a request limit. Try again later. If it continues, the website owner should check this API’s quotas in Google Cloud Console.';
  } else if ((matched = matches(['ClassroomApiDisabled', 'ClassroomDisabled', 'domainPolicy']))) {
    reason = matched;
    guidance = 'Google reports that access is disabled for this account or its organization. Open this Google service with the same account to check access; for a managed account, contact its administrator.';
  }
  const name = service === 'calendar' ? 'Google Calendar API' : 'Google Classroom API';
  return Error(`${name}: ${guidance} [${reason}]`);
}
let libraryPromise;
export function loadGoogleIdentity() {
  if (globalThis.google?.accounts?.oauth2) return Promise.resolve();
  if (libraryPromise) return libraryPromise;
  libraryPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    const timeout = setTimeout(() => { script.remove(); libraryPromise = null; reject(Error('Google sign-in did not load. Check your connection and try again.')); }, 15000);
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); libraryPromise = null; reject(Error('Google sign-in is blocked or unavailable. Check your connection and try again.')); };
    document.head.append(script);
  });
  return libraryPromise;
}
export class GoogleConnection {
  constructor({ fetcher = globalThis.fetch.bind(globalThis), now = () => Date.now() } = {}) {
    this.fetcher = fetcher; this.now = now; this.sessions = {}; this.permissionErrors = {};
  }
  connected(service) { return !!this.sessions[service] && this.sessions[service].expires > this.now(); }
  account(service) { return this.connected(service) ? this.sessions[service].account : null; }
  permissionError(service) { return this.permissionErrors[service] || ''; }
  disconnect(service) {
    delete this.permissionErrors[service];
    const session = this.sessions[service];
    for (const [key, value] of Object.entries(this.sessions)) if (key === service || value === session) delete this.sessions[key];
  }
  connect(service, clientId) {
    const services = service === 'all' ? ['calendar', 'classroom'] : [service];
    const scopes = [...new Set(services.flatMap(key => SCOPES[key]))];
    if (!validClientId(clientId)) return Promise.reject(Error('Set a Google OAuth web client ID in connection setup first.'));
    if (!globalThis.google?.accounts?.oauth2) return Promise.reject(Error('Google sign-in is still loading. Please try Connect again in a moment.'));
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId, scope: ['openid', 'email', ...scopes].join(' '), include_granted_scopes: true,
        error_callback: error => reject(Error(error.type === 'popup_closed' ? 'Sign-in was cancelled. Your existing plans are unchanged.' : 'Google could not open sign-in. Allow popups for this website and try again.')),
        callback: async response => {
          if (response?.error) { reject(Error('Google access was not granted. Please connect again and allow the requested read access.')); return; }
          if (!response?.access_token || !Number.isFinite(Number(response.expires_in)) || Number(response.expires_in) <= 60 || typeof response.scope !== 'string' || !response.scope.trim()) {
            reject(Error('Google returned an incomplete sign-in response. Please reconnect.')); return;
          }
          const missingByService = Object.fromEntries(services.map(key => [key, missingGoogleScopes(response, SCOPES[key])]));
          const courseworkScope = AUTH + 'classroom.coursework.me.readonly';
          const verifyCoursework = missingByService.classroom?.length === 1 && missingByService.classroom[0] === courseworkScope;
          if (!services.some(key => !missingByService[key].length) && !verifyCoursework) {
            reject(Error(permissionMessage(services.flatMap(key => missingByService[key])))); return;
          }
          const session = { token: response.access_token, expires: this.now() + Math.max(0, Number(response.expires_in) - 60) * 1000 };
          try {
            const result = await this.fetcher('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(20000) });
            if (!result.ok) throw Error('Could not verify your Google account. Please reconnect.');
            const profile = await result.json();
            if (!profile.sub) throw Error('Google did not return an account identifier. Please reconnect.');
            session.account = { id: profile.sub, email: profile.email || 'Google account' };
            // Do not guess that similarly named scopes are interchangeable. The API
            // is authoritative: only a successful read can confirm assignment access.
            const courseworkAccess = verifyCoursework ? await this.verifyCourseworkAccess(session) : null;
            if (courseworkAccess?.allowed) missingByService.classroom = [];
            if (!services.some(key => !missingByService[key].length)) throw Error(courseworkAccess?.error || permissionMessage(services.flatMap(key => missingByService[key])));
            for (const key of services) {
              delete this.sessions[key]; delete this.permissionErrors[key];
              if (missingByService[key].length) this.permissionErrors[key] = (key === 'classroom' && courseworkAccess?.error) || permissionMessage(missingByService[key]);
              else this.sessions[key] = session;
            }
            resolve(session.account);
          } catch (error) { reject(error); }
        },
      });
      // Must remain synchronous with the user's click to avoid popup blocking.
      client.requestAccessToken({ prompt: 'consent select_account' });
    });
  }
  async verifyCourseworkAccess(session) {
    const read = url => this.fetcher(url, { headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(10000) });
    const denied = async response => ({ allowed: false, error: response.status === 403 ? (await deniedAccessError('classroom', response)).message : '' });
    try {
      const courses = await read('https://classroom.googleapis.com/v1/courses?studentId=me&courseStates=ACTIVE&pageSize=1&fields=courses(id)');
      if (!courses.ok) return denied(courses);
      const id = (await courses.json()).courses?.[0]?.id;
      if (!id) return { allowed: false }; // No course is not evidence of permission to read assignments.
      const work = await read(`https://classroom.googleapis.com/v1/courses/${encodeURIComponent(id)}/courseWork?pageSize=1&courseWorkStates=PUBLISHED&fields=courseWork(id)`);
      return work.ok ? { allowed: true } : denied(work);
    } catch { return { allowed: false }; }
  }
  async request(service, url) {
    if (!this.connected(service)) throw Error('Your Google session expired. Use Connect to sign in again.');
    const session = this.sessions[service];
    let response;
    try { response = await this.fetcher(url, { headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(25000) }); }
    catch { throw Error('Google could not be reached. Check your connection and try again. Existing imports are unchanged.'); }
    if (this.sessions[service] !== session) throw Error('The connection changed. Please try again.');
    if (response.status === 401) { this.disconnect(service); throw Error('Your Google session expired. Use Connect to sign in again.'); }
    if (response.status === 403) throw await deniedAccessError(service, response);
    if (response.status === 429) throw Error('Google is receiving too many requests. Wait a moment, then try again.');
    if (!response.ok) throw Error(`Google returned an error (${response.status}). Existing imports are unchanged; try again later.`);
    return response.json();
  }
  async pages(service, base, field) {
    const items = []; let pageToken;
    const seen = new Set();
    do {
      const url = new URL(base); if (pageToken) url.searchParams.set('pageToken', pageToken);
      const result = await this.request(service, url.href);
      items.push(...(result[field] || [])); pageToken = result.nextPageToken;
      if (pageToken && seen.has(pageToken)) throw Error('Google returned an invalid page token. Please retry sync.');
      if (pageToken) seen.add(pageToken);
      if (items.length > 15000) throw Error('This selection contains too many items. Select fewer calendars or courses.');
    } while (pageToken);
    return items;
  }
  listCalendars() { return this.pages('calendar', 'https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=250', 'items'); }
  listCourses() { return this.pages('classroom', 'https://classroom.googleapis.com/v1/courses?studentId=me&courseStates=ACTIVE&pageSize=100', 'courses'); }
  calendarEvents(id, from, to) {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(id)}/events`);
    // UTC padding includes all planner-zone dates; conversion later clips to the requested dates.
    url.search = new URLSearchParams({ singleEvents: 'true', showDeleted: 'false', maxResults: '2500', timeMin: `${from}T00:00:00+14:00`, timeMax: `${to}T23:59:59-12:00` });
    return this.pages('calendar', url.href, 'items');
  }
  courseWork(id) { return this.pages('classroom', `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(id)}/courseWork?pageSize=100&courseWorkStates=PUBLISHED`, 'courseWork'); }
  announcements(id) { return this.pages('classroom', `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(id)}/announcements?pageSize=100&announcementStates=PUBLISHED`, 'announcements'); }
  courseMaterials(id) { return this.pages('classroom', `https://classroom.googleapis.com/v1/courses/${encodeURIComponent(id)}/courseWorkMaterials?pageSize=100&courseWorkMaterialStates=PUBLISHED`, 'courseWorkMaterial'); }
}
