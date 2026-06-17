# Bar Island

A live social bar game with player profiles, couples, audience voting, recoupling, and a finale.

## Run locally

```bash
npm install
npm start
```

Open:

- Player/Audience: http://localhost:3000
- Host: http://localhost:3000/host

## Render setup

Use these settings on Render:

- Environment: Node
- Build Command: `npm install`
- Start Command: `npm start`

The app uses `process.env.PORT`, so Render will assign the port automatically.

## GitHub upload

Upload the contents of this folder directly to the root of your GitHub repository. Do not upload the parent folder as an extra nested folder.

## Files

- `server.js` — Express server and game API
- `package.json` — Node app config
- `public/index.html` — player/audience app
- `public/host.html` — host dashboard
- `public/app.js` — player/audience logic
- `public/host.js` — host logic
- `public/style.css` — mobile-friendly styling
- `public/assets/bar-island-title.png` — 9:16 title graphic
- `render.yaml` — optional Render deploy config


## Render Notes
This package is a Node Web Service, not Docker and not Static Site. It binds to `0.0.0.0` and uses Render's `PORT` environment variable.

Render settings:
- Environment: Node
- Build Command: `npm install`
- Start Command: `npm start`
