# Bar Island

Render/GitHub-ready Node web app for Bar Island.

## Render settings

- Environment: Node
- Root Directory: leave blank
- Build Command: `npm install`
- Start Command: `npm start`

## Required environment variable

Set this on the Render Web Service:

- `DATABASE_URL` = Render PostgreSQL Internal Database URL

## Host

- Host URL: `/host`
- Default Host PIN: `1238`

## Included in this build

- Rolling Island Mode
- 10 themed rounds
- Player photo upload
- PostgreSQL persistence
- Public display at `/public`
- Streamlined player layout
- Clear Current Session and Delete Completed Sessions
- Cash Out or Double Down system
- Session 1 and Session 2 cashout prize inputs
- Hidden final grand prize input
- Public cashout prize reveal
- Player cashout/double-down choice screen
- One partner can cash out the whole couple
- Cashed-out couples are removed and replacement spots open
- Final prize remains hidden until winner reveal or host reveal

No `node_modules`, `.npmrc`, or `package-lock.json` are included.

## Session Reset Hard Fix

This build fixes the completed-session reactivation bug:

- `Clear Current Session` now marks the current session as ended and cleared.
- `/api/sessions` no longer auto-selects completed, ended, or cleared sessions.
- `host_state.activeSessionId` stays blank when no live/upcoming/waiting session exists.
- Completed sessions cannot be manually selected as active.
- Public/player screens now show a safe "Session Ended" state and clear stale local session IDs.
- `Delete Completed Sessions` also clears host state if it pointed to a deleted/completed session.

