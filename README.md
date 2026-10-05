# Daylight — Student planner

A responsive scheduling app for classes, tutoring, academy lessons, study sessions, and personal tasks. Built for the AIproject competition website.

## Run locally

Requires Node.js 22 or later. No dependency installation is needed.

```sh
npm run dev
```

Open http://127.0.0.1:5173. Run `npm test` for recurrence, exception, overlap, and calendar-date checks. Run `npm run build` to create the production files in `dist/`; `npm run preview` serves them locally.

## Deploy to Vercel

Push the source files to the GitHub repository and import it into Vercel. Use the **Other** framework preset. The included `vercel.json` sets the build command to `npm run build` and the output directory to `dist`. No environment variables or backend are required.

## Features

- Daily, weekly, and monthly views; compact daily agenda and date selection on mobile.
- Weekly classes on multiple weekdays, with optional recurrence end dates.
- Edit/delete one occurrence, this and future occurrences, or an entire series.
- Single-occurrence cancellation and rescheduling across weeks.
- Desktop drag-and-drop for events and tasks. Resize events using their bottom edge. Both actions open the editor for recurrence scope, validation, and confirmation. Click/tap editing provides a keyboard and touch alternative.
- Side-by-side overlapping events, with conflict warnings before saving.
- Tasks with subjects, priorities, deadlines, estimates, completion, and separate study sessions. A task may have multiple sessions.
- Category filters, upcoming deadlines, next class, and progress indicators.
- Browser-local persistence, sample-data removal, JSON backup export, and validated restore in Settings.

## Data and time behavior

Schedules are saved in this browser's local storage, under `daylight-planner-v1`. They do not sync between browsers/devices. Clearing browser data removes the planner. Export backups using **Settings & data** (the profile button on mobile also opens settings).

The planner initially uses the browser's time zone. Events represent wall-clock times in the chosen planner time zone, with date arithmetic independent of daylight-saving offsets. Changing the time zone changes today's date and the current-time marker without shifting entered class times. Overnight events should be split across two days.

Recurring exceptions are indexed by their original date, so moving a single class into another week does not create a duplicate. Editing “This and future occurrences” creates a new series and resets later exceptions; the editor explains this. Entire-series edits retain existing exceptions when their original day remains part of the pattern.

The sample plan is generated relative to the first visit. Remove it in Settings when ready. Google Fonts is used for typography, with system fallbacks when unavailable. The app has no analytics or third-party data API.

## Source layout

- `src/model.js`: pure recurrence, date, conflict, layout, and sample-data logic.
- `src/app.js`: UI, accessible native dialogs, task/event flows, persistence, and interactions.
- `src/styles.css`: visual design and responsive layouts.
- `tests/model.test.mjs`: scheduling regression tests.
- `scripts/`: dependency-free local server and production build.
