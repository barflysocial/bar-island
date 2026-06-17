# Bar Island

A Node/Express web app for a live bar social game with host dashboard, player/audience screens, public display, PostgreSQL persistence, server-time timers, mingle phase, challenge prompts, recoupling, and finale voting.

## Render setup

Environment: Node
Build Command: npm install
Start Command: npm start
Root Directory: leave blank

Add the PostgreSQL Internal Database URL to the Web Service environment:

DATABASE_URL=your-render-internal-postgres-url

Default host PIN: 1238

Host: /host
Public display: /public
Player/Audience: /

## Latest fixes

- Player profile field label changed from "Type on Paper" to "My Type".
- Fixed player-side `Cannot find variable: me` by adding missing player helper functions.
- Fixed challenge option values so "Me", "My Partner", "Both", and "Neither" submit as safe string values.
- Player challenge screen now recognizes the viewer's submitted answer immediately, even before answers are revealed.
- Kept root-level Render/GitHub package structure with no extra folder wrapper.
