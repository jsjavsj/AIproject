import { addDays, uid } from './model.js';

export const SCOPES = {
  calendar: ['https://www.googleapis.com/auth/calendar.calendarlist.readonly', 'https://www.googleapis.com/auth/calendar.events.readonly'],
  classroom: ['https://www.googleapis.com/auth/classroom.courses.readonly', 'https://www.googleapis.com/auth/classroom.coursework.me.readonly', 'https://www.googleapis.com/auth/classroom.announcements.readonly', 'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly'],
};
export function zonedParts(value, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}
export function safeGoogleLink(value, service) {
  try {
    const url = new URL(value);
    const allowed = service === 'classroom' ? ['classroom.google.com'] : ['calendar.google.com', 'www.google.com'];
    return url.protocol === 'https:' && allowed.includes(url.hostname) ? url.href : '';
  } catch { return ''; }
}
export function calendarToEvents(items, calendar, account, timezone, from, to) {
  const result = [];
  for (const item of items) {
    if (item.status === 'cancelled' || !item.start || !item.end) continue;
    const allDay = !!item.start.date;
    const start = allDay ? { date: item.start.date, time: '00:00' } : zonedParts(item.start.dateTime, timezone);
    const end = allDay ? { date: addDays(item.end.date, -1), time: '23:59' } : zonedParts(item.end.dateTime, timezone);
    // Google supplies exclusive end dates; split overnight/multi-day events into daily segments.
    for (let date = start.date < from ? from : start.date; date <= end.date && date <= to; date = addDays(date, 1)) {
      const segmentStart = date === start.date ? start.time : '00:00';
      const segmentEnd = date === end.date ? end.time : '23:59';
      if (segmentEnd <= segmentStart) continue;
      result.push({
        id: uid(), title: String(item.summary || 'Untitled Google event').slice(0, 100), category: 'personal',
        date, start: segmentStart, end: segmentEnd, allDay, repeat: false, days: [], until: '', exceptions: {},
        location: String(item.location || '').slice(0, 100), instructor: '', notes: String(item.description || '').slice(0, 1000),
        remote: { service: 'calendar', account, container: calendar.id, id: item.id, segment: date, label: calendar.summary || 'Google Calendar', url: safeGoogleLink(item.htmlLink, 'calendar') },
      });
    }
  }
  return result;
}
export function courseworkToTasks(items, course, account, timezone) {
  return items.filter(item => !item.state || item.state === 'PUBLISHED').map(item => {
    let deadline = '', deadlineTime = '';
    if (item.dueDate) {
      const d = item.dueDate, t = item.dueTime || {};
      const instant = new Date(Date.UTC(d.year, d.month - 1, d.day, t.hours || 0, t.minutes || 0));
      const local = zonedParts(instant.toISOString(), timezone);
      deadline = local.date; deadlineTime = local.time;
    }
    return {
      id: uid(), title: String(item.title || 'Untitled assignment').slice(0, 100), subject: String(course.name || 'Classroom').slice(0, 60),
      deadline, deadlineTime, priority: 'medium', duration: 60, done: false,
      remote: { service: 'classroom', account, container: course.id, id: item.id, label: course.name, url: safeGoogleLink(item.alternateLink, 'classroom') },
    };
  });
}
export const remoteKey = item => JSON.stringify([item.remote?.account, item.remote?.container, item.remote?.id, item.remote?.segment || '']);
export function mergeImported(existing, incoming, service) {
  const previous = new Map(existing.filter(e => e.remote?.service === service).map(e => [remoteKey(e), e]));
  const unique = new Map(incoming.map(e => [remoteKey(e), e]));
  const imported = [...unique.values()].map(item => {
    const old = previous.get(remoteKey(item));
    if (!old) return item;
    return { ...item, id: old.id, ...(service === 'classroom' ? { done: old.done, priority: old.priority, duration: old.duration } : {}) };
  });
  // A successful full selected-source refresh removes deleted/deselected remote items, never local plans.
  return [...existing.filter(e => e.remote?.service !== service), ...imported];
}
