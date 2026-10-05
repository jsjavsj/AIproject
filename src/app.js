import { CATEGORIES, uid, addDays, weekday, weekStart as modelWeekStart, minutes, timeString, todayInZone, formatDate, occurrences, changeEvent, conflicts, layoutEvents, sampleData } from './model.js';
import { DEFAULT_LAYOUT, normalizeLayout } from './preferences.js';
import { GoogleConnection, loadGoogleIdentity, validClientId } from './google.js';
import { calendarToEvents, courseworkToTasks, mergeImported, safeGoogleLink } from './google-data.js';

const paths = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M16 3v4M8 3v4M3 11h18m-13 4h2m4 0h2"/>',
  tasks: '<rect x="5" y="4" width="15" height="17" rx="3"/><path d="M9 4V2m6 2V2M9 10l1 1 2-2m2 1h3m-8 6 1 1 2-2m2 1h3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', chevron: '<path d="m9 5 7 7-7 7"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', check: '<path d="m5 12 4 4L19 6"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/>',
  pin: '<path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Z"/><circle cx="12" cy="10" r="2"/>',
  book: '<path d="M12 5v16M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2Z"/>',
  repeat: '<path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4m14-1v2a3 3 0 0 1-3 3H3"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  leaf: '<path d="M20 3C8 2 2 8 6 16s16 1 14-13ZM4 21 16 9"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.calendar}</svg>`;
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KEY = 'daylight-planner-v1';
const defaultZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Seoul';
let storageIssue = '';
let state;
try {
  const saved = localStorage.getItem(KEY);
  state = saved ? JSON.parse(saved) : sampleData(todayInZone(defaultZone), defaultZone);
  validateBackup(state);
} catch {
  state = sampleData(todayInZone(defaultZone), defaultZone);
  storageIssue = 'Saved data could not be loaded. Export your current plan before leaving this page.';
}
state.layout = normalizeLayout(state.layout);
state.connections ||= {};
const weekStart = date => modelWeekStart(date, state.layout.weekStartsOn);
const hourHeight = () => state.layout.density === 'compact' ? 52 : 68;
const googleConnection = new GoogleConnection();
const connectionUI = { calendar: {}, classroom: {} };
const clientId = () => globalThis.DAYLIGHT_CONFIG?.googleClientId || state.connections.clientId || '';
let today = todayInZone(state.timezone), selected = today, view = state.layout.defaultView, page = 'calendar', miniMonth = today.slice(0, 7), taskFilter = 'active';
const enabled = new Set(Object.keys(CATEGORIES));
let editing = null, dragData = null, toastTimer;
const app = document.querySelector('#app');
const dialog = document.querySelector('#editor');
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
  catch { storageIssue = 'Browser storage is unavailable or full. Export your plan to keep your changes.'; return false; }
}
if (!storageIssue) save();
function toast(message) {
  const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 4000);
}
function commit(message) { const saved = save(); render(); toast(saved ? message : storageIssue); }
const prettyTime = time => { const [h, m] = time.split(':').map(Number); return `${h % 12 || 12}${m ? ':' + String(m).padStart(2, '0') : ''}${h >= 12 ? 'pm' : 'am'}`; };
const dateLabel = date => date === today ? 'Today' : date === addDays(today, 1) ? 'Tomorrow' : formatDate(date);
const getEvents = (from, to) => occurrences(state.events, from, to).filter(e => enabled.has(e.category));
const totalScheduled = id => state.events.filter(e => e.taskId === id).reduce((n, e) => n + minutes(e.end) - minutes(e.start), 0);
const byKey = key => {
  const index = key.lastIndexOf(':'); const id = key.slice(0, index); const originalDate = key.slice(index + 1);
  const source = state.events.find(e => e.id === id);
  return source ? { ...source, date: originalDate, ...source.exceptions?.[originalDate], originalDate, seriesId: id, key } : null;
};

function miniCalendar() {
  const first = `${miniMonth}-01`, start = weekStart(first);
  return `<div class="mini-heading"><strong>${formatDate(first, { month: 'long', year: 'numeric' })}</strong><div><button class="icon-button tiny" data-action="mini-prev" aria-label="Previous calendar month">${icon('chevron', 'flip')}</button><button class="icon-button tiny" data-action="mini-next" aria-label="Next calendar month">${icon('chevron')}</button></div></div>
  <div class="mini-calendar">${(state.layout.weekStartsOn === 0 ? ['S', 'M', 'T', 'W', 'T', 'F', 'S'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']).map(d => `<span>${d}</span>`).join('')}${Array.from({ length: 42 }, (_, i) => { const d = addDays(start, i); return `<button data-action="date" data-date="${d}" class="${d === selected ? 'selected' : ''} ${d === today ? 'is-today' : ''} ${d.slice(0, 7) !== miniMonth ? 'muted' : ''}" aria-label="${formatDate(d, { dateStyle: 'full' })}" ${d === selected ? 'aria-current="date"' : ''}>${Number(d.slice(-2))}</button>`; }).join('')}</div>`;
}
function sidebar() {
  return `<aside class="sidebar" aria-label="Workspace navigation"><a class="brand" href="#" aria-label="Daylight home"><span class="brand-mark">${icon('sun')}</span>daylight<span class="brand-period">.</span></a><div class="workspace"><span class="workspace-icon">${icon('book')}</span><div><strong>My workspace</strong><small>A little more organized</small></div></div>
  <p class="nav-label">YOUR SPACE</p><nav>${[['grid', 'overview', 'Overview'], ['calendar', 'calendar', 'My calendar'], ['tasks', 'tasks', 'My tasks']].map(([i, p, label]) => `<button class="nav-item ${page === p ? 'active' : ''}" data-action="page" data-page="${p}">${icon(i)}<span>${label}</span>${p === 'tasks' ? `<span class="nav-count">${state.tasks.filter(t => !t.done).length}</span>` : ''}</button>`).join('')}</nav>
  <section class="mini-section">${miniCalendar()}</section><section class="categories"><p class="nav-label">MY CALENDARS</p>${Object.entries(CATEGORIES).map(([key, label]) => `<label class="category-filter"><input type="checkbox" data-category="${key}" ${enabled.has(key) ? 'checked' : ''} /><span class="category-check ${key}">${icon('check')}</span>${label}<span class="category-dot ${key}"></span></label>`).join('')}</section>
  <div class="sidebar-bottom"><div class="gentle-note">${icon('leaf')}<strong>Progress, at your pace.</strong><p>Make a little room for yourself, too.</p></div><button class="nav-item" data-action="settings">${icon('settings')}<span>Settings & data</span></button><div class="profile"><span class="avatar">S</span><div><strong>Student workspace</strong><small>Personal planner</small></div><span class="online-dot"></span></div></div></aside>`;
}
function render() {
  const previousScroll = app.querySelector('.calendar-scroll');
  const scrollHour = previousScroll ? previousScroll.scrollTop / parseFloat(getComputedStyle(previousScroll).getPropertyValue('--hour-height')) : 8;
  state.layout = normalizeLayout(state.layout);
  document.documentElement.dataset.accent = state.layout.accent;
  document.documentElement.dataset.density = state.layout.density;
  document.documentElement.dataset.taskPanel = state.layout.showTasks ? 'show' : 'hide';
  document.documentElement.dataset.stats = state.layout.showStats ? 'show' : 'hide';
  today = todayInZone(state.timezone);
  const done = state.tasks.filter(t => t.done).length, active = state.tasks.filter(t => !t.done);
  const week = occurrences(state.events, weekStart(selected), addDays(weekStart(selected), 6));
  const hours = week.reduce((n, e) => n + (e.allDay ? 0 : minutes(e.end) - minutes(e.start)), 0) / 60;
  app.innerHTML = `${sidebar()}<main class="main"><header class="topbar"><div class="breadcrumb">My workspace <span>/</span> <strong>${page === 'calendar' ? 'My calendar' : page === 'tasks' ? 'My tasks' : 'Overview'}</strong></div><div class="topbar-right"><button class="button quiet layout-shortcut" data-action="settings">${icon('settings')}<span>Customize</span></button><span class="local-badge"><span></span>${storageIssue ? 'Changes need a backup' : 'Saved on this device'}</span><button class="avatar small" data-action="settings" aria-label="Open settings and backups">S</button></div></header>
  <div class="main-content"><section class="page-heading"><div><div class="eyebrow">A LITTLE STRUCTURE. A LOT OF POSSIBILITY.</div><h1>${page === 'calendar' ? 'Make space for your day' : page === 'tasks' ? 'Small steps. Real progress.' : 'Your day, a little clearer.'}<span class="heading-sun">${icon('sun')}</span></h1><p>Classes, goals, and everything in between. You’ve got this.</p></div><button class="button primary" data-action="add">${icon('plus')}<span>Add new</span></button></section>
  ${storageIssue ? `<div class="warning">${esc(storageIssue)}</div>` : ''}
  <section class="stats"><div class="stat"><span class="stat-icon lavender">${icon('calendar')}</span><div><small>This week</small><strong>${week.length} <span>planned sessions</span></strong></div><span class="stat-note">Let’s make it a good one</span></div><div class="stat"><span class="stat-icon mint">${icon('check')}</span><div><small>Making progress</small><strong>${done}<span> / ${state.tasks.length} tasks complete</span></strong></div><div class="mini-progress" style="--progress:${state.tasks.length ? done / state.tasks.length * 100 : 0}%"></div></div><div class="stat"><span class="stat-icon peach">${icon('clock')}</span><div><small>Time planned</small><strong>${Number(hours.toFixed(1))}<span> hours this week</span></strong></div></div></section>
  <div class="planner-layout ${page !== 'calendar' ? 'alternate-page' : ''}"><section class="calendar-card">${page === 'calendar' ? calendar() : page === 'tasks' ? taskPage() : overview()}</section><aside class="right-panel" aria-label="Tasks and upcoming class">${rightPanel(active, done)}</aside></div>
  <footer class="page-footer"><span>${icon('sun')} A plan for your day. Space for your life.</span><span>${esc(state.timezone)} · Browser-local storage</span></footer></div></main>`;
  bindDrag();
  const calendarScroll = app.querySelector('.calendar-scroll');
  if (calendarScroll) calendarScroll.scrollTop = scrollHour * hourHeight();
}
function calendar() {
  const start = weekStart(selected), end = addDays(start, 6);
  const title = view === 'day' ? formatDate(selected, { month: 'long', day: 'numeric', year: 'numeric' }) : formatDate(selected, { month: 'long', year: 'numeric' });
  return `<div class="calendar-toolbar"><div class="calendar-title"><h2>${title}</h2><span class="week-badge">${view === 'week' ? `${formatDate(start)} – ${formatDate(end)}` : view === 'day' ? formatDate(selected, { weekday: 'long' }) : 'Your month at a glance'}</span></div><div class="calendar-controls"><button class="button quiet today-button" data-action="today">Today</button><button class="icon-button" data-action="prev" aria-label="Previous ${view}">${icon('chevron', 'flip')}</button><button class="icon-button" data-action="next" aria-label="Next ${view}">${icon('chevron')}</button></div></div><div class="view-toolbar"><div class="segmented" aria-label="Calendar view">${['day', 'week', 'month'].map(v => `<button data-action="view" data-view="${v}" class="${view === v ? 'active' : ''}" aria-pressed="${view === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join('')}</div><span class="calendar-hint">${icon('plus')} Click a time to make a plan</span></div>
  ${view === 'month' ? monthCalendar() : timeCalendar(view === 'day' ? [selected] : Array.from({ length: 7 }, (_, i) => addDays(start, i)))}
  <div class="mobile-agenda"><div class="mobile-days">${Array.from({ length: 7 }, (_, i) => { const d = addDays(weekStart(selected), i); return `<button data-action="date" data-date="${d}" class="${d === selected ? 'selected' : ''}" aria-label="${formatDate(d, { dateStyle: 'full' })}"><small>${formatDate(d, { weekday: 'short' })}</small><span>${Number(d.slice(-2))}</span></button>`; }).join('')}</div>${agenda(selected)}</div><div class="calendar-bottom"><span><i class="tiny-dot"></i> Full 24-hour day · Scroll up or down for more times</span><span>Drag to move · Pull an event’s bottom edge to resize</span></div>`;
}
function timeCalendar(dates) {
  const everyEvent = getEvents(dates[0], dates.at(-1));
  const all = everyEvent.filter(e => !e.allDay);
  const firstHour = 0;
  const lastHour = 24;
  const height = (lastHour - firstHour) * hourHeight();
  const nowParts = new Intl.DateTimeFormat('en-GB', { timeZone: state.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
  const nowMinute = minutes(nowParts);
  return `<div class="time-calendar" style="--days:${dates.length};--hour-height:${hourHeight()}px"><div class="day-headers"><div class="zone-label">${esc(new Intl.DateTimeFormat('en', { timeZone: state.timezone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find(p => p.type === 'timeZoneName').value)}</div>${dates.map(d => `<button class="day-header ${d === today ? 'today' : ''}" data-action="date" data-date="${d}"><small>${formatDate(d, { weekday: 'short' })}</small><span>${Number(d.slice(-2))}</span>${d === today ? '<i></i>' : ''}</button>`).join('')}</div>
  ${everyEvent.some(e => e.allDay) ? `<div class="all-day-grid"><span>All day</span>${dates.map(d => `<div>${everyEvent.filter(e => e.allDay && e.date === d).map(e => `<button class="all-day-event ${e.category}" data-action="event" data-key="${e.key}">${esc(e.title)}</button>`).join('')}</div>`).join('')}</div>` : ''}<div class="calendar-scroll"><div class="time-grid" style="height:${height}px"><div class="time-axis">${Array.from({ length: lastHour - firstHour }, (_, i) => `<span style="top:${i * hourHeight()}px">${prettyTime(timeString((firstHour + i) * 60))}</span>`).join('')}</div>${dates.map(d => {
    const dayEvents = layoutEvents(all.filter(e => e.date === d));
    return `<div class="day-column ${d === today ? 'today-column' : ''}" data-date="${d}" data-first-hour="${firstHour}">${Array.from({ length: (lastHour - firstHour) * 2 }, (_, i) => `<button class="time-slot" style="top:${i * hourHeight() / 2}px" data-action="slot" data-date="${d}" data-time="${timeString(firstHour * 60 + i * 30)}" aria-label="Add event on ${formatDate(d)} at ${prettyTime(timeString(firstHour * 60 + i * 30))}"></button>`).join('')}${dayEvents.map(e => eventCard(e, firstHour)).join('')}${d === today && nowMinute >= firstHour * 60 && nowMinute < lastHour * 60 ? `<div class="now-line" style="top:${(nowMinute - firstHour * 60) / 60 * hourHeight()}px"><span></span></div>` : ''}</div>`;
  }).join('')}</div></div></div>`;
}
function eventCard(e, firstHour) {
  const height = Math.max(20, (minutes(e.end) - minutes(e.start)) / 60 * hourHeight() - 4);
  return `<div class="calendar-event ${e.category} ${height < 55 ? 'short-event' : ''}" draggable="${!e.remote}" data-key="${e.key}" style="top:${(minutes(e.start) - firstHour * 60) / 60 * hourHeight() + 2}px;height:${height}px;left:calc(${e.column / e.columns * 100}% + 4px);width:calc(${100 / e.columns}% - 8px)"><button class="event-main" data-action="event" data-key="${e.key}" aria-label="${e.remote ? 'View' : 'Edit'} ${esc(e.title)}, ${prettyTime(e.start)} to ${prettyTime(e.end)}"><span class="event-title">${esc(e.title)}</span><span class="event-time">${prettyTime(e.start)} – ${prettyTime(e.end)}</span>${height > 80 ? `<span class="event-location">${esc(e.location || e.remote?.label || CATEGORIES[e.category])}</span>` : ''}${e.repeat ? icon('repeat', 'event-repeat') : ''}</button>${!e.remote ? `<span class="resize-handle" data-key="${e.key}" title="Drag to change duration"></span>` : ''}</div>`;
}
function monthCalendar() {
  const first = selected.slice(0, 7) + '-01', start = weekStart(first), days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  const list = getEvents(start, days.at(-1));
  return `<div class="month-calendar"><div class="month-weekdays">${(state.layout.weekStartsOn === 0 ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']).map(d => `<span>${d}</span>`).join('')}</div><div class="month-grid">${days.map(d => `<div class="month-cell ${d.slice(0, 7) !== selected.slice(0, 7) ? 'outside' : ''}"><button class="month-date ${d === today ? 'today' : ''}" data-action="open-day" data-date="${d}" aria-label="Open ${formatDate(d)}">${Number(d.slice(-2))}</button>${list.filter(e => e.date === d).slice(0, 3).map(e => `<button class="month-event ${e.category}" data-action="event" data-key="${e.key}">${esc(e.title)}</button>`).join('')}${list.filter(e => e.date === d).length > 3 ? `<button class="more-events" data-action="open-day" data-date="${d}">+${list.filter(e => e.date === d).length - 3} more</button>` : ''}</div>`).join('')}</div></div>`;
}
function agenda(date) {
  const list = getEvents(date, date);
  return `<div class="agenda-heading"><h3>${date === today ? 'Today’s schedule' : formatDate(date, { weekday: 'long', month: 'short', day: 'numeric' })}</h3><span>${list.length} sessions</span></div>${list.length ? list.map(e => `<button class="agenda-item" data-action="event" data-key="${e.key}"><span class="agenda-time">${e.allDay ? 'All day' : prettyTime(e.start)}<small>${e.allDay ? '' : prettyTime(e.end)}</small></span><span class="agenda-marker ${e.category}"></span><span><strong>${esc(e.title)}</strong><small>${esc(e.location || e.remote?.label || CATEGORIES[e.category])}${e.instructor ? ` · ${esc(e.instructor)}` : ''}</small></span>${icon('chevron')}</button>`).join('') : `<div class="empty-state">${icon('sun')}<h3>A little breathing room</h3><p>No plans for this day yet.</p><button class="button quiet" data-action="slot" data-date="${date}" data-time="09:00">Add your first plan</button></div>`}`;
}
function taskRow(task, expanded = false) {
  const scheduled = totalScheduled(task.id);
  return `<article class="task-row ${task.done ? 'completed' : ''}" draggable="${!task.done}" data-task="${task.id}"><button class="task-check ${task.done ? 'checked' : ''}" data-action="complete" data-id="${task.id}" aria-label="${task.done ? 'Mark incomplete' : 'Complete'}: ${esc(task.title)}" aria-pressed="${task.done}">${task.done ? icon('check') : ''}</button><div class="task-content"><button class="task-title" data-action="edit-task" data-id="${task.id}">${esc(task.title)}</button><div class="task-meta"><span>${esc(task.subject || 'Personal')}</span><span>·</span><span>${task.duration} min</span></div><div class="task-tags"><span class="priority ${task.priority}">${task.priority === 'high' ? 'High priority' : task.priority === 'medium' ? 'Medium' : 'Low'}</span>${task.deadline ? `<span class="due ${task.deadline < today && !task.done ? 'overdue' : ''}">${task.deadline < today && !task.done ? 'Overdue · ' : ''}${dateLabel(task.deadline)}</span>` : ''}</div>${task.remote ? `<span class="source-chip classroom-chip">Classroom${task.deadlineTime ? ` · Due ${prettyTime(task.deadlineTime)}` : ''}</span>` : ''}${expanded && scheduled ? `<small class="scheduled-detail">${scheduled} of ${task.duration} minutes scheduled</small>` : ''}${!task.done ? `<button class="schedule-link" data-action="schedule-task" data-id="${task.id}">${icon('plus')} ${scheduled ? 'Add study session' : 'Schedule time'}</button>` : ''}</div></article>`;
}
function rightPanel(active, done) {
  const next = occurrences(state.events, today, addDays(today, 14)).find(e => ['school', 'academy', 'tutoring'].includes(e.category) && (e.date > today || minutes(e.end) > minutes(new Intl.DateTimeFormat('en-GB', { timeZone: state.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()))));
  return `<div class="right-heading"><h2>Your to-dos <span>${active.length}</span></h2><button class="icon-button" data-action="new-task" aria-label="Add task">${icon('plus')}</button></div><p class="panel-subtitle">One thing at a time.</p><div class="task-tabs"><button class="${taskFilter === 'active' ? 'active' : ''}" data-action="task-filter" data-filter="active">To do</button><button class="${taskFilter === 'today' ? 'active' : ''}" data-action="task-filter" data-filter="today">Today</button><button class="${taskFilter === 'unscheduled' ? 'active' : ''}" data-action="task-filter" data-filter="unscheduled">Unscheduled</button><button class="${taskFilter === 'done' ? 'active' : ''}" data-action="task-filter" data-filter="done">Done</button></div><div class="task-list">${(() => { const list = state.tasks.filter(t => taskFilter === 'done' ? t.done : !t.done && (taskFilter !== 'unscheduled' || totalScheduled(t.id) < t.duration) && (taskFilter !== 'today' || (t.deadline && t.deadline <= today) || occurrences(state.events, today, today).some(e => e.taskId === t.id))); return list.length ? list.map(t => taskRow(t)).join('') : `<div class="small-empty">${icon('check')}<p>${taskFilter === 'done' ? 'Your finished tasks will live here.' : 'You’re all caught up here.'}</p></div>`; })()}</div><button class="add-task-dashed" data-action="new-task">${icon('plus')} Add a task</button>
  <div class="daily-progress"><div><strong>Your progress</strong><span>${done}/${state.tasks.length}</span></div><div class="progress-track"><span style="width:${state.tasks.length ? done / state.tasks.length * 100 : 0}%"></span></div><p>${done ? 'Look at you, moving things forward.' : 'Every small step counts.'} ${icon('spark')}</p></div>
  ${next ? `<div class="up-next"><div class="up-next-label"><i></i> NEXT CLASS</div><h3>${esc(next.title)}</h3><p>${dateLabel(next.date)} · ${prettyTime(next.start)} – ${prettyTime(next.end)}</p><div><span>${icon('pin')}${esc(next.location || CATEGORIES[next.category])}</span><button class="icon-button" data-action="event" data-key="${next.key}" aria-label="Edit next class">${icon('arrow')}</button></div></div>` : '<div class="up-next"><h3>You have some open space.</h3><p>Add your weekly classes to get started.</p></div>'}
  <div class="storage-note">${icon('leaf')}<p>Your plan stays in this browser.<br>Export a backup in Settings.</p></div>`;
}
function taskPage() {
  return `<div class="section-heading"><div><h2>All your tasks</h2><p>Give every deadline a little time in your day.</p></div><button class="button primary" data-action="new-task">${icon('plus')} New task</button></div><div class="full-task-list">${state.tasks.length ? [...state.tasks].sort((a, b) => Number(a.done) - Number(b.done) || (a.deadline || '9999').localeCompare(b.deadline || '9999')).map(t => taskRow(t, true)).join('') : '<div class="empty-state"><h3>A fresh start</h3><p>Add a task and break it into manageable study sessions.</p></div>'}</div>`;
}
function overview() {
  const deadlines = state.tasks.filter(t => !t.done && t.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 5);
  return `<div class="overview-welcome"><span class="eyebrow">YOUR DAILY RESET</span><h2>Hello, new possibilities.</h2><p>You don’t have to do it all. Just start with what matters today.</p><div class="orbit-art" aria-hidden="true">${icon('sun')}</div></div><div class="overview-content">${agenda(today)}<div class="agenda-heading"><h3>On the horizon</h3><span>Upcoming deadlines</span></div>${deadlines.length ? deadlines.map(t => `<button class="deadline-item" data-action="edit-task" data-id="${t.id}"><span class="deadline-date ${t.deadline < today ? 'overdue' : ''}">${dateLabel(t.deadline)}</span><strong>${esc(t.title)}</strong>${icon('chevron')}</button>`).join('') : '<p class="panel-subtitle">No upcoming deadlines. Enjoy the breathing room.</p>'}</div>`;
}

function openDialog(content) {
  delete dialog.dataset.settingsTab;
  dialog.innerHTML = content;
  if (!dialog.open) dialog.showModal();
  dialog.scrollTop = 0;
  requestAnimationFrame(() => dialog.querySelector('input:not([type="checkbox"]), button')?.focus({ preventScroll: true }));
}
const dialogHeader = (title, subtitle) => `<div class="dialog-heading"><div><span class="eyebrow">MAKE A LITTLE SPACE</span><h2 id="dialog-title">${title}</h2><p>${subtitle}</p></div><button class="icon-button" data-action="close" aria-label="Close dialog">${icon('close')}</button></div>`;
function showAdd() {
  openDialog(`${dialogHeader('What’s on your mind?', 'A class to attend, or something to get done?')}<div class="add-options"><button data-action="new-event"><span class="stat-icon lavender">${icon('calendar')}</span><strong>Event or class</strong><p>Classes, tutoring, and time for yourself.</p>${icon('arrow')}</button><button data-action="new-task"><span class="stat-icon mint">${icon('tasks')}</span><strong>Task or homework</strong><p>Deadlines, big ideas, and small steps.</p>${icon('arrow')}</button></div>`);
}
function showEvent(occurrence = null, defaults = {}) {
  if (occurrence?.remote) { showRemoteEvent(occurrence); return; }
  const source = occurrence && state.events.find(e => e.id === occurrence.seriesId);
  const task = defaults.taskId && state.tasks.find(t => t.id === defaults.taskId);
  const date = defaults.date || occurrence?.date || selected;
  const data = { title: '', category: task ? 'study' : 'academy', date, start: '15:00', end: '16:00', repeat: false, days: [weekday(date)], until: '', location: '', instructor: '', notes: '', ...occurrence, ...defaults };
  if (task) { data.title = task.title; data.end = timeString(Math.min(1439, minutes(data.start) + Math.min(120, Math.max(15, task.duration - totalScheduled(task.id))))); }
  editing = { occurrence, taskId: data.taskId, original: data };
  openDialog(`${dialogHeader(occurrence ? 'A little change of plans' : task ? 'Make time for your task' : 'Make a new plan', task ? `${totalScheduled(task.id)} of ${task.duration} minutes already scheduled. Add as many sessions as you need.` : 'Put the important things in your day.')}<form id="event-form">
  <label>Event name<input name="title" required maxlength="100" placeholder="e.g. Math tutoring" value="${esc(data.title)}" /></label>
  <div class="form-row"><label>Calendar<select name="category">${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${k}" ${data.category === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label><label>Date<input name="date" type="date" required min="2000-01-01" max="2100-12-31" value="${data.date}" /></label></div>
  <div class="form-row"><label>Start time<input name="start" type="time" required value="${data.start}" /></label><label>End time<input name="end" type="time" required value="${data.end}" /></label></div>
  ${source?.repeat ? `<label>Apply changes to<select name="scope"><option value="one">Only this occurrence</option><option value="future">This and future occurrences</option><option value="all">Entire series</option></select></label><p class="field-note" id="scope-note">Your other classes will stay on their regular schedule.</p>` : '<input type="hidden" name="scope" value="all" />'}
  <div class="recurrence-options ${source?.repeat ? 'hidden' : ''}"><label class="checkbox-label"><input type="checkbox" name="repeat" ${source?.repeat || data.repeat ? 'checked' : ''} />${icon('repeat')} Repeat every week</label><div class="repeat-fields ${source?.repeat || data.repeat ? '' : 'hidden'}"><span class="field-label">Repeat on</span><div class="weekday-picker">${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d, i) => `<label><input type="checkbox" name="days" value="${i}" ${(data.days || []).includes(i) ? 'checked' : ''}/><span>${d}</span></label>`).join('')}</div><label>Repeat until <span class="optional">(optional)</span><input type="date" name="until" min="${date}" max="2100-12-31" value="${data.until}" /></label><p class="field-note">The selected date is the recurrence start date. Leave the end date empty to keep repeating.</p></div></div>
  <div class="form-row"><label>Location <span class="optional">(optional)</span><input name="location" maxlength="100" value="${esc(data.location)}" placeholder="Room, academy, or online" /></label><label>Instructor <span class="optional">(optional)</span><input name="instructor" maxlength="100" value="${esc(data.instructor)}" placeholder="Who’s teaching?" /></label></div><label>Notes <span class="optional">(optional)</span><textarea name="notes" rows="2" maxlength="1000" placeholder="Anything you’d like to remember">${esc(data.notes)}</textarea></label>
  <p class="field-note">Times follow ${esc(state.timezone)}. Events start and end on the same day.</p><div class="form-error" role="alert"></div><div id="conflict-warning"></div><div class="dialog-actions">${occurrence ? '<button type="button" class="button danger" data-action="delete-event">Delete event</button>' : ''}<span></span><button type="button" class="button quiet" data-action="close">Cancel</button><button class="button primary" type="submit">${occurrence ? 'Save changes' : 'Create event'}</button></div></form>`);
}
function showTask(id) {
  const task = state.tasks.find(t => t.id === id) || { title: '', subject: '', deadline: selected, priority: 'medium', duration: 60 };
  editing = { taskId: id };
  openDialog(`${dialogHeader(id ? 'A task, on your terms' : 'One small step', 'A deadline is a goal. You can schedule study time separately.')}<form id="task-form"><label>Task name<input name="title" required maxlength="100" value="${esc(task.title)}" placeholder="What would you like to get done?" /></label><div class="form-row"><label>Subject<input name="subject" maxlength="60" value="${esc(task.subject)}" placeholder="e.g. Mathematics" /></label><label>Deadline <span class="optional">(optional)</span><input name="deadline" type="date" min="2000-01-01" max="2100-12-31" value="${task.deadline}" /></label></div><div class="form-row"><label>Priority<select name="priority">${['low', 'medium', 'high'].map(p => `<option ${p === task.priority ? 'selected' : ''} value="${p}">${p[0].toUpperCase() + p.slice(1)}</option>`).join('')}</select></label><label>Estimated minutes<input name="duration" type="number" min="5" max="10080" required value="${task.duration}" /></label></div><div class="form-error" role="alert"></div><div class="dialog-actions">${id ? '<button class="button danger" type="button" data-action="delete-task">Delete task</button>' : ''}<span></span><button class="button quiet" type="button" data-action="close">Cancel</button><button class="button primary" type="submit">${id ? 'Save task' : 'Add task'}</button></div></form>`);
  if (task.remote) {
    const link = safeGoogleLink(task.remote.url, 'classroom');
    dialog.querySelector('#task-form').insertAdjacentHTML('afterbegin', `<div class="source-notice"><strong>Imported from Google Classroom</strong><p>The assignment and deadline come from Classroom. Set your own priority and estimate here. Checking it off does not submit your work.</p>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Open assignment in Classroom ↗</a>` : ''}</div>`);
    for (const name of ['title', 'subject', 'deadline']) dialog.querySelector(`[name="${name}"]`).readOnly = true;
    const remove = dialog.querySelector('[data-action="delete-task"]');
    if (remove) remove.textContent = 'Remove local task';
  }
}
function showDataSettings() {
  const zones = [...new Set([state.timezone, defaultZone, 'Asia/Seoul', 'Asia/Tokyo', 'Asia/Singapore', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney', 'UTC'])];
  openDialog(`${dialogHeader('Your space, your settings', 'A few things to make Daylight feel like you.')}<form id="settings-form"><label>Planner time zone<select name="timezone">${zones.map(z => `<option ${z === state.timezone ? 'selected' : ''}>${z}</option>`).join('')}</select></label><p class="field-note">Class times stay at the wall-clock time you entered. Changing this setting changes “today” and the current-time indicator; it does not convert your class times.</p><div class="settings-section"><h3>Saved in this browser</h3><p>Your schedule stays on this device and browser. There is no account or cloud sync. Export a backup before clearing browser data or switching devices.</p><button type="button" class="button quiet" data-action="export">${icon('download')} Export backup</button><label class="import-label">Restore a Daylight backup<input type="file" id="import-file" accept=".json,application/json" /></label></div>${state.events.some(e => e.demo) || state.tasks.some(t => t.demo) ? '<div class="settings-section"><h3>Ready for your own plans?</h3><p>Remove the sample classes and tasks. Your own entries will stay.</p><button type="button" class="button danger" data-action="clear-demo">Remove sample data</button></div>' : ''}<div class="dialog-actions"><span></span><button type="button" class="button quiet" data-action="close">Close</button><button class="button primary">Save settings</button></div></form>`);
}
const settingsTabs = tab => `<nav class="settings-tabs" aria-label="Settings sections">${[['layout', 'Layout'], ['connections', 'Connections'], ['data', 'Data & time']].map(([key, label]) => `<button data-action="settings-tab" data-tab="${key}" class="${tab === key ? 'active' : ''}" aria-pressed="${tab === key}">${label}</button>`).join('')}</nav>`;
function showSettings(tab = 'layout') {
  if (tab === 'data') {
    showDataSettings(); dialog.querySelector('.dialog-heading').insertAdjacentHTML('afterend', settingsTabs(tab));
  } else if (tab === 'connections') {
    showConnections();
  } else {
    const layout = state.layout;
    const options = (values, selected) => values.map(([v, label]) => `<option value="${v}" ${String(selected) === String(v) ? 'selected' : ''}>${label}</option>`).join('');
    openDialog(`${dialogHeader('A planner that feels like you', 'Choose how you see your day. Preferences stay in this browser.')}${settingsTabs('layout')}<form id="layout-form">
      <div class="layout-preview" data-preview-accent="${layout.accent}" aria-hidden="true"><div class="preview-sidebar"></div><div class="preview-main"><div class="preview-top"></div><div class="preview-columns"><i></i><i></i><i></i><i></i><i></i></div></div><div class="preview-tasks"><i></i><i></i><i></i></div></div>
      <fieldset class="accent-picker"><legend>Accent color</legend>${[['indigo', 'Soft indigo'], ['forest', 'Forest green'], ['rose', 'Dusty rose']].map(([value, label]) => `<label><input type="radio" name="accent" value="${value}" ${layout.accent === value ? 'checked' : ''}/><span class="accent-dot ${value}"></span>${label}</label>`).join('')}</fieldset>
      <div class="form-row"><label>Open calendar in<select name="defaultView">${options([['day', 'Day view'], ['week', 'Week view'], ['month', 'Month view']], layout.defaultView)}</select></label><label>Week starts on<select name="weekStartsOn">${options([[1, 'Monday'], [0, 'Sunday']], layout.weekStartsOn)}</select></label></div>
      <label>Layout spacing<select name="density">${options([['comfortable', 'Comfortable — more breathing room'], ['compact', 'Compact — more on your screen']], layout.density)}</select></label>
      <label class="layout-toggle"><span><strong>Task panel</strong><small>Show your to-dos alongside the calendar.</small></span><input type="checkbox" name="showTasks" ${layout.showTasks ? 'checked' : ''}/></label>
      <label class="layout-toggle"><span><strong>Weekly overview cards</strong><small>Show sessions, task progress, and planned hours.</small></span><input type="checkbox" name="showStats" ${layout.showStats ? 'checked' : ''}/></label>
      <div class="dialog-actions"><button type="button" class="button quiet" data-action="layout-reset">Reset layout</button><span></span><button type="button" class="button quiet" data-action="close">Cancel</button><button class="button primary">Save layout</button></div></form>`);
  }
  dialog.dataset.settingsTab = tab;
}
function showConnections() {
  const configured = validClientId(clientId());
  openDialog(`${dialogHeader('Bring your plans together', 'Your classes and commitments, in one calm place.')}${settingsTabs('connections')}
    <div class="connection-intro">Read-only imports. Your Google events and assignments are never changed by Daylight.</div>
    ${!configured ? `<div class="setup-callout"><strong>One-time Google setup needed</strong><p>The website owner needs to create a Google OAuth client ID. After setup, each student connects their own Google account.</p><a href="/google-setup.html" target="_blank" rel="noopener" class="button quiet">Open setup guide ${icon('arrow')}</a></div>` : ''}
    ${['calendar', 'classroom'].map(service => connectionCard(service, configured)).join('')}
    <details class="connection-setup"><summary>Website owner setup</summary><p>For production, set GOOGLE_CLIENT_ID in Vercel and redeploy. For local testing, you can save a public client ID below. Never enter a client secret.</p><form id="google-config-form"><label>Google OAuth web client ID<input name="clientId" value="${esc(clientId())}" placeholder="123456-example.apps.googleusercontent.com" ${globalThis.DAYLIGHT_CONFIG?.googleClientId ? 'readonly' : ''} required /></label><button class="button quiet" ${globalThis.DAYLIGHT_CONFIG?.googleClientId ? 'disabled' : ''}>Save test client ID</button><div class="form-error" role="alert"></div></form><a href="/google-setup.html" target="_blank" rel="noopener">Read the complete setup guide ↗</a></details>
    <p class="field-note connection-privacy">Access tokens stay in memory and expire. Reconnect after refreshing this page. Imported items stay in this browser until refreshed or removed. <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener">Manage Google permissions ↗</a></p>`);
  dialog.dataset.settingsTab = 'connections';
  if (configured) loadGoogleIdentity().catch(error => { if (dialog.dataset.settingsTab === 'connections' && dialog.open) toast(error.message); });
}
function connectionCard(service, configured) {
  const isCalendar = service === 'calendar', meta = state.connections[service] || {}, ui = connectionUI[service];
  const account = googleConnection.account(service), connected = !!account;
  const list = ui.items || [], count = (isCalendar ? state.events : state.tasks).filter(e => e.remote?.service === service).length;
  const busy = !!ui.busy;
  return `<section class="connection-card"><div class="connection-heading"><span class="service-icon ${service}">${icon(isCalendar ? 'calendar' : 'book')}</span><div><h3>Google ${isCalendar ? 'Calendar' : 'Classroom'}</h3><span class="connection-status ${connected ? 'connected' : ''}">${connected ? 'Connected for this session' : meta.syncedAt ? 'Reconnect to refresh' : configured ? 'Not connected' : 'Setup required'}</span></div></div>
    <p>${isCalendar ? 'Import events from your calendars, including recurring classes and all-day events.' : 'Turn assignments from your enrolled courses into tasks with due dates.'}</p>
    ${account || meta.email ? `<div class="connection-account">${esc(account?.email || meta.email)}</div>` : ''}
    ${meta.syncedAt ? `<p class="sync-meta">Last import: ${esc(new Date(meta.syncedAt).toLocaleString())} · ${count} ${isCalendar ? 'event segments' : 'tasks'}</p>` : ''}
    ${connected && ui.items ? `<fieldset class="source-picker"><legend>${isCalendar ? 'Choose calendars' : 'Choose courses'}</legend>${list.length ? list.map(item => `<label><input type="checkbox" data-source="${service}" value="${esc(item.id)}" ${(meta.selectedIds || []).includes(item.id) ? 'checked' : ''} ${busy ? 'disabled' : ''}/><span>${esc(item.summary || item.name)}${item.primary ? ' <small>Primary</small>' : ''}</span></label>`).join('') : `<p>No ${isCalendar ? 'calendars' : 'active enrolled courses'} were found for this account.</p>`}</fieldset>` : ''}
    ${isCalendar ? `<p class="field-note">Imports the previous 30 days and next 180 days. Sync replaces this Google snapshot; your own plans stay.</p>` : `<p class="field-note">Completion is your personal checklist, not submission status. Turn in work in Classroom.</p>`}
    ${ui.error ? `<p class="form-error" role="alert">${esc(ui.error)}</p>` : ''}${ui.notice ? `<p class="sync-success" role="status">${esc(ui.notice)}</p>` : ''}
    <div class="connection-actions">${connected ? `<button class="button primary" data-action="google-sync" data-service="${service}" ${busy || !list.length ? 'disabled' : ''}>${busy ? esc(ui.busy) : 'Sync selected'}</button><button class="button quiet" data-action="google-sources" data-service="${service}" ${busy ? 'disabled' : ''}>Refresh list</button><button class="text-button" data-action="google-disconnect" data-service="${service}" ${busy ? 'disabled' : ''}>Disconnect</button>` : `<button class="button primary" data-action="google-connect" data-service="${service}" ${!configured || busy ? 'disabled' : ''}>${busy ? esc(ui.busy) : 'Connect Google ' + (isCalendar ? 'Calendar' : 'Classroom')}</button>`}${count ? `<button class="text-button danger-text" data-action="google-remove" data-service="${service}" ${busy ? 'disabled' : ''}>Remove imports</button>` : ''}</div></section>`;
}
function refreshConnections() { if (dialog.open && dialog.dataset.settingsTab === 'connections') showConnections(); }
async function loadSources(service) {
  const items = service === 'calendar' ? await googleConnection.listCalendars() : await googleConnection.listCourses();
  connectionUI[service].items = items;
  const account = googleConnection.account(service), old = state.connections[service] || {};
  const sameAccount = old.accountId === account.id;
  const selectedIds = sameAccount && Array.isArray(old.selectedIds) ? old.selectedIds.filter(id => items.some(item => item.id === id)) : items.filter(item => service === 'classroom' || item.primary).map(item => item.id);
  state.connections[service] = { ...(sameAccount ? old : {}), accountId: account.id, email: account.email, selectedIds };
  save();
}
async function connectGoogle(service) {
  const ui = connectionUI[service]; if (ui.busy) return;
  ui.error = ''; ui.notice = ''; ui.busy = 'Connecting…';
  // Start OAuth before any await or re-render so the popup belongs to the click.
  const promise = googleConnection.connect(service, clientId()); refreshConnections();
  try { await promise; await loadSources(service); ui.notice = 'Choose what to import, then select Sync selected.'; }
  catch (error) { ui.error = error.message; }
  finally { ui.busy = ''; refreshConnections(); }
}
async function syncGoogle(service, sourcesOnly = false) {
  const ui = connectionUI[service]; if (ui.busy) return;
  ui.error = ''; ui.notice = ''; ui.busy = sourcesOnly ? 'Loading…' : 'Syncing…'; refreshConnections();
  try {
    if (sourcesOnly) { await loadSources(service); return; }
    const account = googleConnection.account(service);
    if (!account) throw Error('Reconnect to Google before syncing.');
    const ids = state.connections[service]?.selectedIds || [];
    if (!ids.length) throw Error('Choose at least one calendar or course to import.');
    const from = addDays(todayInZone(state.timezone), -30), to = addDays(todayInZone(state.timezone), 180);
    const timezone = state.timezone, incoming = [];
    for (const id of ids) {
      const container = ui.items.find(item => item.id === id); if (!container) continue;
      if (service === 'calendar') incoming.push(...calendarToEvents(await googleConnection.calendarEvents(id, from, to), container, account.id, timezone, from, to));
      else incoming.push(...courseworkToTasks(await googleConnection.courseWork(id), container, account.id, timezone));
    }
    if (state.timezone !== timezone) throw Error('Your planner time zone changed during import. Sync again to use the new time zone.');
    if (incoming.length > 4500) throw Error('Too many items to import at once. Select fewer calendars or courses.');
    const field = service === 'calendar' ? 'events' : 'tasks';
    const merged = mergeImported(state[field], incoming, service);
    if (merged.length > 5000) throw Error('The planner is full. Remove some items before syncing.');
    state[field] = merged;
    state.connections[service].syncedAt = new Date().toISOString();
    const saved = save(); render(); ui.notice = saved ? `Imported ${incoming.length} ${service === 'calendar' ? 'event segments' : 'assignments'}. You’re up to date.` : storageIssue;
  } catch (error) { ui.error = error.message; }
  finally { ui.busy = ''; refreshConnections(); }
}
function showRemoteEvent(event) {
  const url = safeGoogleLink(event.remote.url, 'calendar');
  openDialog(`${dialogHeader(esc(event.title), 'Imported from Google Calendar')}<div class="remote-details"><span class="source-chip">${esc(event.remote.label)}</span><h3>${formatDate(event.date, { dateStyle: 'full' })}</h3><p>${event.allDay ? 'All day' : `${prettyTime(event.start)} – ${prettyTime(event.end)} · ${esc(state.timezone)}`}</p>${event.location ? `<p>${icon('pin')} ${esc(event.location)}</p>` : ''}<p class="remote-notes">${esc(event.notes)}</p><p class="field-note">This is a read-only snapshot. Edit the original in Google Calendar, then sync again in Connections.</p></div><div class="dialog-actions"><button class="button quiet" data-action="settings-tab" data-tab="connections">Connections</button><span></span>${url ? `<a class="button primary" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open in Google Calendar ↗</a>` : ''}</div>`);
}
function eventSubmit(form, force = false) {
  const f = new FormData(form), one = editing.occurrence && f.get('scope') === 'one';
  const patch = { title: f.get('title').trim(), category: f.get('category'), date: f.get('date'), start: f.get('start'), end: f.get('end'), repeat: !one && f.has('repeat'), days: f.getAll('days').map(Number), until: f.get('until') || '', location: f.get('location').trim(), instructor: f.get('instructor').trim(), notes: f.get('notes').trim() };
  const error = form.querySelector('.form-error');
  if (!patch.title) { error.textContent = 'Give your event a name.'; return; }
  if (minutes(patch.end) <= minutes(patch.start)) { error.textContent = 'End time must be later than start time on the same day.'; return; }
  if (patch.repeat && !patch.days.length) { error.textContent = 'Choose at least one day to repeat.'; return; }
  if (patch.repeat && patch.until && patch.until < patch.date) { error.textContent = 'The recurrence end date must be on or after the start date.'; return; }
  error.textContent = '';
  let next;
  if (editing.occurrence) next = changeEvent(state.events, editing.occurrence, patch, f.get('scope'));
  else next = [...state.events, { ...patch, id: uid(), exceptions: {}, ...(editing.taskId ? { taskId: editing.taskId } : {}) }];
  const from = patch.date;
  // Check a full weekly pattern plus every explicitly dated event and exception.
  const checkpoints = new Set([from, ...next.flatMap(e => [e.date, ...Object.values(e.exceptions || {}).filter(x => x.date).map(x => x.date)])]);
  const affected = new Set(next.filter(e => !state.events.includes(e)).map(e => e.id));
  const conflict = [...checkpoints].flatMap(d => conflicts(next, d, addDays(d, 7))).find(pair => pair.some(e => affected.has(e.seriesId)) && pair.some(e => e.date >= from));
  if (conflict && !force) {
    form.querySelector('#conflict-warning').innerHTML = `<div class="warning"><strong>A little overlap</strong><p>“${esc(conflict[0].title)}” and “${esc(conflict[1].title)}” overlap on ${formatDate(conflict[0].date)}. Both will be shown side by side.</p><button type="button" class="button quiet" data-action="save-overlap">Save anyway</button></div>`;
    return;
  }
  state.events = next; dialog.close(); commit(editing.occurrence ? 'Your schedule is updated.' : 'A little more organized. Event added.');
}
function shiftMonth(date, amount) {
  const d = new Date(`${date.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + amount);
  return d.toISOString().slice(0, 10);
}
function navigateDate(date) { selected = date; miniMonth = date.slice(0, 7); render(); }
function scheduleTask(id, date = selected, start) {
  const task = state.tasks.find(t => t.id === id);
  if (!task) return;
  if (!start) {
    const list = occurrences(state.events, date, date);
    const duration = Math.min(120, Math.max(15, task.duration - totalScheduled(id)));
    let slot = 9 * 60;
    while (slot + duration <= 23 * 60 && list.some(e => minutes(e.start) < slot + duration && minutes(e.end) > slot)) slot += 30;
    start = timeString(Math.min(slot, 22 * 60));
  }
  showEvent(null, { taskId: id, date, start });
}
document.addEventListener('click', e => {
  const button = e.target.closest('[data-action]');
  if (!button) return;
  const { action, id, date, time, key } = button.dataset;
  if (action === 'close') dialog.close();
  else if (action === 'page') { page = button.dataset.page; render(); }
  else if (action === 'add') showAdd();
  else if (action === 'new-event') showEvent();
  else if (action === 'new-task') showTask();
  else if (action === 'event') showEvent(byKey(key));
  else if (action === 'slot') showEvent(null, { date, start: time, end: timeString(Math.min(1439, minutes(time) + 60)), days: [weekday(date)] });
  else if (action === 'view') { view = button.dataset.view; render(); }
  else if (action === 'today') navigateDate(today);
  else if (action === 'date' || action === 'open-day') { if (action === 'open-day') view = 'day'; page = 'calendar'; navigateDate(date); }
  else if (action === 'prev' || action === 'next') { const n = action === 'next' ? 1 : -1; navigateDate(view === 'month' ? shiftMonth(selected, n) : addDays(selected, n * (view === 'week' ? 7 : 1))); }
  else if (action.startsWith('mini-')) { miniMonth = shiftMonth(miniMonth + '-01', action === 'mini-next' ? 1 : -1).slice(0, 7); render(); }
  else if (action === 'task-filter') { taskFilter = button.dataset.filter; render(); }
  else if (action === 'complete') { state.tasks = state.tasks.map(t => t.id === id ? { ...t, done: !t.done } : t); commit('Task progress updated. Keep going!'); }
  else if (action === 'edit-task') showTask(id);
  else if (action === 'schedule-task') scheduleTask(id);
  else if (action === 'save-overlap') { const form = dialog.querySelector('form'); if (form.reportValidity()) eventSubmit(form, true); }
  else if (action === 'delete-event') {
    const scope = new FormData(dialog.querySelector('form')).get('scope');
    if (confirm(`Delete ${scope === 'one' ? 'only this occurrence' : scope === 'future' ? 'this and all future occurrences' : 'this event and its entire series'}?`)) {
      state.events = changeEvent(state.events, editing.occurrence, {}, scope, true); dialog.close(); commit('Event removed. A little more breathing room.');
    }
  } else if (action === 'delete-task') {
    if (confirm('Delete this task and its scheduled study sessions?')) { state.tasks = state.tasks.filter(t => t.id !== editing.taskId); state.events = state.events.filter(t => t.taskId !== editing.taskId); dialog.close(); commit('Task and its study sessions removed.'); }
  } else if (action === 'settings') showSettings();
  else if (action === 'settings-tab') showSettings(button.dataset.tab);
  else if (action === 'layout-reset') { state.layout = { ...DEFAULT_LAYOUT }; view = state.layout.defaultView; commit('Layout reset. Your plans are unchanged.'); showSettings('layout'); }
  else if (action === 'google-connect') connectGoogle(button.dataset.service);
  else if (action === 'google-sync') syncGoogle(button.dataset.service);
  else if (action === 'google-sources') syncGoogle(button.dataset.service, true);
  else if (action === 'google-disconnect') { const service = button.dataset.service; googleConnection.disconnect(service); connectionUI[service] = {}; refreshConnections(); toast('Disconnected in this browser. Imported items are kept.'); }
  else if (action === 'google-remove') {
    const service = button.dataset.service;
    if (confirm('Remove these Google imports from Daylight? Your Google data and your own plans will stay.')) {
      const field = service === 'calendar' ? 'events' : 'tasks';
      state[field] = state[field].filter(item => item.remote?.service !== service);
      if (state.connections[service]) delete state.connections[service].syncedAt;
      commit('Imported items removed.'); refreshConnections();
    }
  }
  else if (action === 'clear-demo') { if (confirm('Remove the sample events and tasks? Your own plans will stay.')) { const demoTasks = new Set(state.tasks.filter(t => t.demo).map(t => t.id)); state.events = state.events.filter(e => !e.demo).map(e => demoTasks.has(e.taskId) ? { ...e, taskId: undefined } : e); state.tasks = state.tasks.filter(t => !t.demo); commit('A fresh start. Your planner is ready.'); showSettings(); } }
  else if (action === 'export') {
    const url = URL.createObjectURL(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `daylight-${today}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('Your backup is ready.');
  }
});
document.addEventListener('submit', e => {
  e.preventDefault();
  if (e.target.id === 'event-form') eventSubmit(e.target);
  if (e.target.id === 'task-form') {
    const f = new FormData(e.target); const patch = { title: f.get('title').trim(), subject: f.get('subject').trim(), deadline: f.get('deadline'), priority: f.get('priority'), duration: Number(f.get('duration')) };
    if (!patch.title) { e.target.querySelector('.form-error').textContent = 'Give your task a name.'; return; }
    state.tasks = editing.taskId ? state.tasks.map(t => t.id === editing.taskId ? { ...t, ...patch } : t) : [...state.tasks, { ...patch, id: uid(), done: false }]; dialog.close(); commit('Task saved. One step closer.');
  }
  if (e.target.id === 'settings-form') { const changed = state.timezone !== new FormData(e.target).get('timezone'); state.timezone = new FormData(e.target).get('timezone'); dialog.close(); commit(changed ? 'Time zone saved. Sync Google imports again to update their displayed times.' : 'Settings saved.'); }
  if (e.target.id === 'layout-form') {
    const f = new FormData(e.target);
    state.layout = normalizeLayout({ defaultView: f.get('defaultView'), weekStartsOn: f.get('weekStartsOn'), density: f.get('density'), accent: f.get('accent'), showTasks: f.has('showTasks'), showStats: f.has('showStats') });
    view = state.layout.defaultView; dialog.close(); commit('Your layout, your way. Preferences saved.');
  }
  if (e.target.id === 'google-config-form') {
    const value = new FormData(e.target).get('clientId').trim();
    if (!validClientId(value)) { e.target.querySelector('.form-error').textContent = 'Enter a web client ID ending in .apps.googleusercontent.com, not a client secret.'; return; }
    state.connections.clientId = value;
    for (const service of ['calendar', 'classroom']) { googleConnection.disconnect(service); connectionUI[service] = {}; }
    save(); showSettings('connections'); toast('Client ID saved. You can now connect your Google account.');
  }
});
document.addEventListener('change', async e => {
  if (e.target.name === 'accent') dialog.querySelector('.layout-preview').dataset.previewAccent = e.target.value;
  if (e.target.dataset.source) {
    const service = e.target.dataset.source;
    state.connections[service].selectedIds = [...dialog.querySelectorAll(`[data-source="${service}"]:checked`)].map(input => input.value); save();
  }
  if (e.target.dataset.category) { e.target.checked ? enabled.add(e.target.dataset.category) : enabled.delete(e.target.dataset.category); render(); }
  if (e.target.name === 'repeat') dialog.querySelector('.repeat-fields').classList.toggle('hidden', !e.target.checked);
  if (e.target.name === 'scope') {
    dialog.querySelector('.recurrence-options').classList.toggle('hidden', e.target.value === 'one');
    dialog.querySelector('#scope-note').textContent = e.target.value === 'one' ? 'Your other classes will stay on their regular schedule.' : e.target.value === 'future' ? 'Starts a new schedule here. Later individual exceptions will be reset.' : 'Changes the whole series. Existing individual exceptions stay as they are.';
  }
  if (e.target.name === 'date' && !editing?.occurrence) {
    dialog.querySelectorAll('[name="days"]').forEach(input => input.checked = Number(input.value) === weekday(e.target.value));
    dialog.querySelector('[name="until"]').min = e.target.value;
  }
  if (e.target.id === 'import-file' && e.target.files[0]) {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      validateBackup(data);
      if (confirm('Replace your current planner with this backup? Export your current plan first if you want to keep it.')) { state = data; state.layout = normalizeLayout(state.layout); state.connections ||= {}; for (const service of ['calendar', 'classroom']) { googleConnection.disconnect(service); connectionUI[service] = {}; } view = state.layout.defaultView; selected = todayInZone(state.timezone); miniMonth = selected.slice(0, 7); storageIssue = ''; dialog.close(); commit('Your planner has been restored.'); }
    } catch { toast('That file is not a valid Daylight backup. Your plan has not changed.'); }
  }
});
function validateBackup(data) {
  const dateOK = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && d >= '2000-01-01' && d <= '2100-12-31' && addDays(d, 0) === d;
  const timeOK = t => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);
  const textOK = t => typeof t === 'string' && t.length <= 2000;
  const idOK = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id);
  const eventOK = e => textOK(e.title) && Object.hasOwn(CATEGORIES, e.category) && dateOK(e.date) && timeOK(e.start) && timeOK(e.end) && minutes(e.end) > minutes(e.start);
  if (data?.version !== 1 || !Array.isArray(data.events) || !Array.isArray(data.tasks) || data.events.length > 5000 || data.tasks.length > 5000) throw Error();
  if (data.connections !== undefined && (!data.connections || typeof data.connections !== 'object' || Array.isArray(data.connections))) throw Error();
  for (const service of ['calendar', 'classroom']) {
    const meta = data.connections?.[service];
    if (meta !== undefined && (!meta || typeof meta !== 'object' || (meta.selectedIds !== undefined && (!Array.isArray(meta.selectedIds) || meta.selectedIds.some(id => !textOK(id)))))) throw Error();
  }
  todayInZone(data.timezone);
  if (data.events.some(e => !idOK(e.id) || !eventOK(e) || typeof e.repeat !== 'boolean' || !Array.isArray(e.days) || e.days.some(d => !Number.isInteger(d) || d < 0 || d > 6) || (e.repeat && !e.days.length) || (e.until && !dateOK(e.until)) || (e.taskId && !idOK(e.taskId)) || Object.entries(e.exceptions || {}).some(([d, x]) => !dateOK(d) || (!x.deleted && !eventOK(x))))) throw Error();
  if (data.tasks.some(t => !idOK(t.id) || !textOK(t.title) || !textOK(t.subject) || typeof t.done !== 'boolean' || !['low', 'medium', 'high'].includes(t.priority) || !Number.isFinite(t.duration) || t.duration < 5 || t.duration > 10080 || (t.deadline && !dateOK(t.deadline)))) throw Error();
  if (new Set(data.events.map(e => e.id)).size !== data.events.length || new Set(data.tasks.map(t => t.id)).size !== data.tasks.length) throw Error();
}
function bindDrag() {
  app.querySelectorAll('[draggable="true"]').forEach(el => el.addEventListener('dragstart', e => {
    dragData = el.dataset.key ? { key: el.dataset.key } : { taskId: el.dataset.task };
    e.dataTransfer.setData('text/plain', JSON.stringify(dragData)); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging');
  }));
  app.querySelectorAll('.day-column').forEach(col => {
    col.addEventListener('dragover', e => { if (dragData) { e.preventDefault(); col.classList.add('drag-target'); } });
    col.addEventListener('dragleave', e => { if (!col.contains(e.relatedTarget)) col.classList.remove('drag-target'); });
    col.addEventListener('drop', e => {
      e.preventDefault(); col.classList.remove('drag-target'); if (!dragData) return;
      const startMin = Math.max(0, Math.min(1425, Number(col.dataset.firstHour) * 60 + Math.floor((e.clientY - col.getBoundingClientRect().top) / hourHeight() * 4) * 15));
      const date = col.dataset.date, start = timeString(startMin);
      if (dragData.taskId) scheduleTask(dragData.taskId, date, start);
      else { const occ = byKey(dragData.key); if (occ) showEvent(occ, { date, start, end: timeString(Math.min(1439, startMin + minutes(occ.end) - minutes(occ.start))), days: [weekday(date)] }); }
      dragData = null;
    });
  });
  app.querySelectorAll('.resize-handle').forEach(handle => handle.addEventListener('pointerdown', e => {
    e.preventDefault(); e.stopPropagation(); const card = handle.parentElement, originalHeight = card.style.height;
    const occ = byKey(handle.dataset.key), y = e.clientY; let end = minutes(occ.end);
    card.draggable = false; handle.setPointerCapture(e.pointerId);
    const move = ev => { end = Math.min(1439, Math.max(minutes(occ.start) + 15, minutes(occ.end) + Math.round((ev.clientY - y) / hourHeight() * 4) * 15)); card.style.height = `${(end - minutes(occ.start)) / 60 * hourHeight() - 4}px`; };
    const stop = ev => { handle.removeEventListener('pointermove', move); card.draggable = true; card.style.height = originalHeight; if (ev.type !== 'pointercancel' && end !== minutes(occ.end)) showEvent(occ, { end: timeString(end) }); };
    handle.addEventListener('pointermove', move); handle.addEventListener('pointerup', stop, { once: true }); handle.addEventListener('pointercancel', stop, { once: true });
  }));
}
document.addEventListener('dragend', () => { dragData = null; document.querySelectorAll('.dragging, .drag-target').forEach(el => el.classList.remove('dragging', 'drag-target')); });
document.querySelector('#app').addEventListener('click', e => { if (e.target.closest('.brand')) { e.preventDefault(); page = 'overview'; render(); } });
dialog.addEventListener('click', e => { if (e.target === dialog && (e.clientX < dialog.getBoundingClientRect().left || e.clientX > dialog.getBoundingClientRect().right || e.clientY < dialog.getBoundingClientRect().top || e.clientY > dialog.getBoundingClientRect().bottom)) dialog.close(); });
render();
