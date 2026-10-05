export const CATEGORIES = { school: 'School', tutoring: 'Tutoring', academy: 'Academy', study: 'Study time', personal: 'Personal' };
export const uid = () => globalThis.crypto.randomUUID();
export function addDays(date, amount) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + amount);
  return d.toISOString().slice(0, 10);
}
export const weekday = date => new Date(`${date}T12:00:00Z`).getUTCDay();
export const weekStart = (date, startsOn = 1) => addDays(date, -((weekday(date) - startsOn + 7) % 7));
export const minutes = time => Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]);
export const timeString = n => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
export function todayInZone(zone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
export function formatDate(date, options = { month: 'short', day: 'numeric' }) {
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}
export function occursOn(event, date) {
  return event.repeat ? date >= event.date && (!event.until || date <= event.until) && event.days.includes(weekday(date)) : event.date === date;
}
export function occurrences(events, from, to) {
  const result = [];
  for (const event of events) {
    for (let date = from; date <= to; date = addDays(date, 1)) {
      if (occursOn(event, date) && !event.exceptions?.[date]) result.push({ ...event, date, originalDate: date, seriesId: event.id, key: `${event.id}:${date}` });
    }
    for (const [originalDate, exception] of Object.entries(event.exceptions || {})) {
      if (!exception.deleted && exception.date >= from && exception.date <= to && occursOn(event, originalDate)) {
        result.push({ ...event, ...exception, originalDate, seriesId: event.id, key: `${event.id}:${originalDate}` });
      }
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start));
}
// Exceptions are indexed by the original occurrence date, even when moved to another week.
export function changeEvent(events, occurrence, patch, scope = 'one', remove = false) {
  const source = events.find(e => e.id === occurrence.seriesId);
  if (!source) return events;
  const original = occurrence.originalDate;
  if (!source.repeat || scope === 'all') {
    if (remove) return events.filter(e => e.id !== source.id);
    const updated = { ...source, ...patch };
    if (source.repeat && scope === 'all' && updated.repeat) {
      const delta = Math.round((new Date(`${patch.date}T12:00:00Z`) - new Date(`${occurrence.date}T12:00:00Z`)) / 86400000);
      updated.date = addDays(source.date, delta);
    }
    if (!updated.repeat) updated.exceptions = {};
    return events.map(e => e.id === source.id ? updated : e);
  }
  if (scope === 'one') {
    const exception = remove ? { deleted: true } : { ...patch, repeat: false };
    return events.map(e => e.id === source.id ? { ...e, exceptions: { ...e.exceptions, [original]: exception } } : e);
  }
  const pastExceptions = Object.fromEntries(Object.entries(source.exceptions || {}).filter(([d]) => d < original));
  const next = events.map(e => e.id === source.id ? { ...e, until: addDays(original, -1), exceptions: pastExceptions } : e);
  if (!remove) next.push({ ...source, ...patch, id: uid(), date: patch.date, exceptions: {} });
  return next;
}
export function conflicts(events, from, to) {
  const list = occurrences(events, from, to);
  const pairs = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length && list[j].date === list[i].date; j++) {
      if (minutes(list[i].start) < minutes(list[j].end) && minutes(list[j].start) < minutes(list[i].end)) pairs.push([list[i], list[j]]);
    }
  }
  return pairs;
}
// Connected overlap groups share columns; adjacent events can use the full width.
export function layoutEvents(events) {
  const sorted = [...events].sort((a, b) => minutes(a.start) - minutes(b.start));
  const output = [];
  let group = [], end = -1;
  const flush = () => {
    const columns = [];
    for (const event of group) {
      let col = columns.findIndex(e => e <= minutes(event.start));
      if (col < 0) col = columns.length;
      columns[col] = minutes(event.end);
      output.push({ ...event, column: col, group });
    }
    group.columns = columns.length;
  };
  for (const event of sorted) {
    if (minutes(event.start) >= end && group.length) { flush(); group = []; end = -1; }
    group.push(event); end = Math.max(end, minutes(event.end));
  }
  if (group.length) flush();
  return output.map(({ group: g, ...event }) => ({ ...event, columns: g.columns }));
}
export function sampleData(today, timezone) {
  const mon = weekStart(today);
  const make = (title, category, offset, start, end, days, location = '', instructor = '') => ({ id: uid(), title, category, date: addDays(mon, offset), start, end, repeat: !!days, days: days || [], until: '', location, instructor, notes: '', exceptions: {}, demo: true });
  const tasks = [
    { id: uid(), title: 'Finish calculus practice', subject: 'Mathematics', priority: 'high', duration: 60, deadline: today, done: false, demo: true },
    { id: uid(), title: 'Read The Great Gatsby, ch. 4', subject: 'Literature', priority: 'medium', duration: 30, deadline: addDays(today, 1), done: false, demo: true },
    { id: uid(), title: 'Prepare chemistry lab notes', subject: 'Chemistry', priority: 'medium', duration: 45, deadline: addDays(today, 2), done: false, demo: true },
    { id: uid(), title: 'Review Korean vocabulary', subject: 'Languages', priority: 'low', duration: 20, deadline: today, done: true, demo: true }
  ];
  return { version: 1, timezone, tasks, events: [
    make('Morning classes', 'school', 0, '08:30', '11:00', [1, 2, 3, 4, 5], 'School'),
    make('Math tutoring', 'tutoring', 0, '13:00', '14:30', [1, 3], 'Room 204', 'Ms. Kim'),
    make('English academy', 'academy', 1, '15:00', '16:30', [2, 4], 'Bright Academy', 'Mr. Park'),
    make('Chemistry review', 'study', 1, '12:30', '13:30'),
    make('Essay writing', 'study', 3, '12:30', '14:00'),
    make('Piano lesson', 'personal', 4, '14:00', '15:00', [5], 'Music studio'),
    make('A little time outside', 'personal', 5, '10:00', '11:30'),
    { ...make('Calculus practice', 'study', 0, '16:00', '17:00'), taskId: tasks[0].id }
  ] };
}
