# Daylight — Student planner

A responsive scheduling app for classes, tutoring, academy lessons, study sessions, and personal tasks. Built for the AIproject competition website.

## Run locally

Requires Node.js 22 or later. No dependency installation is needed.

```sh
npm run dev
```

Open http://127.0.0.1:5173. Run `npm test` for recurrence, exception, overlap, and calendar-date checks. Run `npm run build` to create the production files in `dist/`; `npm run preview` serves them locally.

## Deploy to Vercel

Push the source files to the GitHub repository and import it into Vercel. Use the **Other** framework preset. The included `vercel.json` sets the build command to `npm run build` and the output directory to `dist`. No backend is required. Google connections are optional: set `GOOGLE_CLIENT_ID` to your public Google OAuth web client ID and redeploy to enable them for visitors. Never configure a client secret in this app. The [Google setup guide](google-setup.html) is also available from Settings on the website.

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
- Layout preferences: default calendar view, Sunday/Monday week start, comfortable/compact spacing, three accent colors, and optional task panel and summary cards.
- Google Calendar: select calendars and manually import the previous 30 days and next 180 days, including expanded recurring occurrences, all-day events, and split overnight events. Imports are read-only and link to the original event.
- Google Classroom: select active enrolled courses and import published assignments with deadlines converted from UTC to the planner time zone. Keep personal priorities, estimates, study-session links, and completion across refreshes. Checking off a task does not submit an assignment.

## Connect Google

1. Create a Google Cloud project and enable Google Calendar API and Google Classroom API.
2. Configure Google Auth Platform and add test users for a competition demo in Testing mode.
3. Create a **Web application** OAuth client. Authorize your exact Vercel origin and `http://localhost:5173` / `http://127.0.0.1:5173` for local testing.
4. Set `GOOGLE_CLIENT_ID` in Vercel and redeploy. For local testing, save the public ID in **Customize → Connections → Website owner setup**.
5. Select **Google sign-in → Sign in with Google**, choose one Google account, and grant read access to both Calendar and Classroom. Select calendars/courses and use **Sync selected** in each section.

A single permission flow connects both services to the same verified Google account. Switching accounts replaces both connections and clears the previous account's imported copies, while retaining personal plans. One **Sign out** button clears both in-memory connections; imported copies remain available in the browser until removed or replaced on an account switch. Denied permissions do not establish a partially connected new account.

The website includes [detailed instructions and troubleshooting](google-setup.html). Google may require app verification before public use; school administrators may restrict third-party app access. This integration uses the official [Google Identity Services browser token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model). It requires read-only Calendar and Classroom scopes plus `openid` and `email` for account identity. It does not need an API key or client secret.

Access tokens live only in memory. Reconnect after a refresh or expiry; no background sync or refresh tokens are stored. Import selections, account labels, last-sync timestamps, and imported records are stored locally and included in backups. Disconnect clears this browser session; removing imports deletes local copies only. Google permission revocation is available through the link in Connections.

A successful sync replaces all previously imported records for that service with the selected sources. It removes deleted/deselected records and preserves local plans. Failed requests (including a failed later page or course) leave the previous import intact. Calendar changes are made in Google; Classroom submission happens in Classroom. Imported assignment title/subject/deadline are read-only, while personal priority and estimate are editable. Changing the planner time zone requires syncing again to update imported times.

## Data and time behavior

Schedules are saved in this browser's local storage, under `daylight-planner-v1`. They do not sync between browsers/devices. Clearing browser data removes the planner. Export backups using **Settings & data** (the profile button on mobile also opens settings).

The planner initially uses the browser's time zone. Events represent wall-clock times in the chosen planner time zone, with date arithmetic independent of daylight-saving offsets. Changing the time zone changes today's date and the current-time marker without shifting entered class times. Overnight events should be split across two days.

Recurring exceptions are indexed by their original date, so moving a single class into another week does not create a duplicate. Editing “This and future occurrences” creates a new series and resets later exceptions; the editor explains this. Entire-series edits retain existing exceptions when their original day remains part of the pattern.

The sample plan is generated relative to the first visit. Remove it in Settings when ready. Google Fonts is used for typography, with system fallbacks when unavailable. The app has no analytics. When a user connects Google, the browser calls Google APIs directly; this app has no server storing Google data.

## Source layout

- `src/model.js`: pure recurrence, date, conflict, layout, and sample-data logic.
- `src/app.js`: UI, accessible native dialogs, task/event flows, persistence, and interactions.
- `src/styles.css`: visual design and responsive layouts.
- `src/settings.css`, `src/preferences.js`: connection/layout UI styling and validated layout preferences.
- `src/google.js`: Google Identity Services authorization and paginated API requests.
- `src/google-data.js`: time-zone conversion, source metadata, and stable import merging.
- `tests/model.test.mjs`: scheduling regression tests.
- `tests/google.test.mjs`: import, error-handling, identity, and layout tests.
- `tests/google-browser-mock.js`, `tests/browser-google-flow.js`: isolated simulated browser integration test (never included in the production build).
- `scripts/`: dependency-free local server and production build.
