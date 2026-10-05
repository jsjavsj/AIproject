import { SCOPES } from './google-data.js';

export const validClientId = value => /^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);
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
    this.fetcher = fetcher; this.now = now; this.sessions = {};
  }
  connected(service) { return !!this.sessions[service] && this.sessions[service].expires > this.now(); }
  account(service) { return this.connected(service) ? this.sessions[service].account : null; }
  disconnect(service) {
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
          if (response.error) { reject(Error('Google access was not granted. Please connect again and allow the requested read access.')); return; }
          if (!google.accounts.oauth2.hasGrantedAllScopes(response, ...scopes)) { reject(Error('Some required permissions were declined. Sign in again and allow read access to both Calendar and Classroom.')); return; }
          const session = { token: response.access_token, expires: this.now() + Math.max(0, Number(response.expires_in) - 60) * 1000 };
          try {
            const result = await this.fetcher('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(20000) });
            if (!result.ok) throw Error('Could not verify your Google account. Please reconnect.');
            const profile = await result.json();
            if (!profile.sub) throw Error('Google did not return an account identifier. Please reconnect.');
            session.account = { id: profile.sub, email: profile.email || 'Google account' };
            for (const key of services) this.sessions[key] = session;
            resolve(session.account);
          } catch (error) { reject(error); }
        },
      });
      // Must remain synchronous with the user's click to avoid popup blocking.
      client.requestAccessToken({ prompt: 'select_account' });
    });
  }
  async request(service, url) {
    if (!this.connected(service)) throw Error('Your Google session expired. Use Connect to sign in again.');
    const session = this.sessions[service];
    let response;
    try { response = await this.fetcher(url, { headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(25000) }); }
    catch { throw Error('Google could not be reached. Check your connection and try again. Existing imports are unchanged.'); }
    if (this.sessions[service] !== session) throw Error('The connection changed. Please try again.');
    if (response.status === 401) { this.disconnect(service); throw Error('Your Google session expired. Use Connect to sign in again.'); }
    if (response.status === 403) throw Error('Google denied access. Check API enablement, consent permissions, and your school’s app-access policy.');
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
}
