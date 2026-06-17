# Bar Island

Render/GitHub-ready Node web app.

## Render settings

Environment: Node
Root Directory: leave blank
Build Command: npm install
Start Command: npm start

## Required Environment Variable for persistence

DATABASE_URL = Render PostgreSQL Internal Database URL

## Host

Host dashboard: /host
Default PIN: 1238

## This build includes

- Lobby / waiting room after profile submission
- Lobby countdown based on scheduled game time and server time
- Host Start Now and Delay 5 Minutes controls
- Public display lobby countdown with QR/session code/player count
- Audience/player vote confirmation state: selected card turns green and button changes to Voted ✓
- One vote per voter per voting round/phase
- Round 7/fill-in-the-blank draft persistence while typing so polling does not erase text
- Submitted typed answers reload after refresh
- Player names used in prompts/options where possible, while backend values stay me/partner/both/neither
- Session reset hard fix retained
- Cash Out / Double Down retained
- Rolling Island Mode retained
