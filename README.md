# Bar Island — Full Gameplay Build

Render/GitHub-ready Node app for Bar Island.

## Render Settings

Build Command:
```bash
npm install
```

Start Command:
```bash
npm start
```

## Required for persistence

Add the PostgreSQL Internal Database URL to the **Bar Island Web Service** environment variables:

```text
DATABASE_URL=your Render PostgreSQL Internal Database URL
```

Optional host PIN override:

```text
HOST_PIN=1238
```

Default host PIN is `1238`.

## Routes

```text
/         Player + Audience landing page
/host     PIN-protected host dashboard
/public   TV/projector public display
/api/health  Storage/server-time health check
/api/questions  100-question pool check
```

## New in this build

- Player-side challenge answer area now appears during challenge rounds.
- Challenge prompts can be multiple-choice or typed.
- Choice prompts use quick buttons.
- Typed prompts use a short answer box.
- Question countdown timers appear on player, host, and public screens.
- Timers use server time via server timestamps, not each phone's clock.
- Host screen shows server time and live question progress.
- Host can reveal or hide challenge answers.
- Host can restart the current question timer.
- A 100-question Bar Island prompt pool is built in.
- Each scheduled game locks its own random question set so refreshes do not reshuffle prompts.
- The session question set is stored in PostgreSQL with the rest of the game state.
- Host active session still persists through PostgreSQL `host_state`.
- `/public` display remains available for TV/projector use.

## Question timing defaults

```text
Choice questions: 30 seconds
Typed public prompts: 60 seconds
Finale prompts: 90 seconds
```

## Deploy check

After deploy, Render logs should show:

```text
Connected to PostgreSQL. Database tables ready.
Bar Island running on 0.0.0.0:PORT. Storage: PostgreSQL. Question pool: 100
```

If the host page shows `Storage: memory`, the `DATABASE_URL` is missing or attached to the wrong Render service.

## Latest gameplay update

This build adds a server-time Couple Mingle phase after First Coupling and before Challenge 1.

- Host clicks **1. Couple Up + 5-Min Mingle** to auto-pair and start the 5-minute talk timer.
- Player phones show partner name, talk timer, and optional conversation starters.
- Public display shows a mingle countdown for the room.
- Host can **Skip to Challenge 1** or **Add 1 Minute**.
- Mingle prompts are optional only; challenge prompts remain required timed answers.
- Mingle timing uses server time and persists with the session.
