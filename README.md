# Bar Island

A Render/GitHub-ready Node web app for the Bar Island live bar game.

## Render settings

- Environment: Node
- Build Command: `npm install`
- Start Command: `npm start`

The app binds to `0.0.0.0` and uses Render's `PORT` environment variable.

## Main routes

- `/` — player/audience landing screen
- `/host` — PIN-protected host dashboard
- `/public` — TV/projector public display

## Default host PIN

`1238`

You can override it on Render with an environment variable:

`HOST_PIN=your-pin-here`

## Public display

From the host dashboard, select a scheduled game and click **Open Public Display**. It opens:

`/public?code=SESSIONCODE`

The public screen shows the title graphic, session code, server-time countdown, couples, vote board, challenge answers, recoupling watch, and winner screen. It has no host controls.

## Host refresh persistence

The host dashboard now stores host unlock and selected active game in `localStorage`, while game/session data persists server-side in `data/sessions.json`.

## Local run

```bash
npm install
npm start
```

Open:

- Player/Audience: `http://localhost:3000`
- Host: `http://localhost:3000/host`
- Public Display: `http://localhost:3000/public`
