# Bar Island — Host Persistence Hard Fix

Render/GitHub Node build for Bar Island.

## Render Settings

Build Command:
```bash
npm install
```

Start Command:
```bash
npm start
```

Environment variable required for persistent host/game state:
```text
DATABASE_URL=your Render PostgreSQL Internal Database URL
```

Optional:
```text
HOST_PIN=1238
```

## What this hard fix changes

- Adds PostgreSQL `host_state` table.
- Saves the active host session ID on the server, not only in localStorage.
- `/api/sessions` returns the active host session and reloads it after refresh.
- Selecting a scheduled game updates the active host session in PostgreSQL.
- Creating a scheduled game automatically makes it the active host session.
- Host auto-refresh no longer re-renders/reset the screen while the host is typing in the create-game form.
- Keeps `/public` display and PIN-protected `/host`.

## Host PIN

Default host PIN:
```text
1238
```

## Deploy Check

After deploy, Render logs should show:
```text
Connected to PostgreSQL. Database tables ready, including host_state.
Bar Island running on 0.0.0.0:PORT. Storage: PostgreSQL
```

If the host page shows `Storage: memory`, the `DATABASE_URL` is missing or attached to the wrong Render service.
