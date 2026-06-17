# Bar Island

A Node/Express live bar social game with player profiles, contestant photo uploads, audience voting, public display, host PIN protection, server-time timers, 10 themed rounds, PostgreSQL persistence, and a 100-question prompt pool.

## Render

Use a Node Web Service.

- Build Command: `npm install`
- Start Command: `npm start`
- Root Directory: leave blank

Set environment variable:

- `DATABASE_URL` = your Render PostgreSQL Internal Database URL
- optional `HOST_PIN` = custom host PIN; default is `1238`

## Routes

- `/` player/audience entry
- `/host` PIN-protected host dashboard
- `/public` TV/projector public display

## Notes

This ZIP is root-level Render/GitHub ready. Do not upload it inside an extra folder. `package.json` should be visible at the GitHub repo root.
