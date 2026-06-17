# Bar Island

Render/GitHub-ready Node web app for **Bar Island** with PostgreSQL persistence.

## Render settings

- Environment: Node
- Build Command: `npm install`
- Start Command: `npm start`

## Required environment variables

Set this on the Render Web Service:

- `DATABASE_URL` = your Render PostgreSQL **Internal Database URL**

Optional:

- `HOST_PIN` = host dashboard PIN. Default is `1238`.

## Routes

- `/` player-facing home screen
- `/host` PIN-protected host dashboard
- `/public` TV/projector display

## Persistence

This build uses the `pg` package and creates a PostgreSQL `sessions` table automatically on server start. Session state, players, couples, votes, rounds, and winners are saved to PostgreSQL so the host dashboard can refresh without losing the active game.

If `DATABASE_URL` is missing, the app falls back to temporary memory storage and the host state can reset after server restarts. On Render, use PostgreSQL.
