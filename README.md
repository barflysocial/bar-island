# Bar Island

Render/GitHub-ready Node web app.

## Render settings

Environment: Node
Root Directory: leave blank
Build Command: npm install
Start Command: npm start

## Required Environment Variable for persistence

DATABASE_URL = Render PostgreSQL Internal Database URL

Optional:
HOST_PIN = 1238
VOTE_SECONDS = 300
WINNER_VOTE_SECONDS = 75
MINGLE_SECONDS = 300
RECOUPLING_SECONDS = 45

## Host

Host dashboard: /host
Default PIN: 1238

## This build includes

- Fully Automated Game Mode option at game creation
- Host can switch between Manual Host Control and Fully Automated mode
- Automated mode advances phases by server-time timers
- Automated mode starts from lobby at scheduled game time
- Voting timer support
- Host vote controls: Start Vote Timer, Add 30 Seconds, Lock/Reveal Vote
- Vote timer displays on player/audience, host, and public screens
- Votes lock after the voting timer expires
- Auto Dump toggle on host screen
- If Auto Dump is on, bottom couples are dumped automatically after voting closes:
  - Bottom 3 after the early dump point
  - Bottom 1 during survival when eligible
- Host override controls remain available: pause, resume, manual phase changes, clear session, delete sessions
- Lobby / waiting room after profile submission
- Lobby countdown based on scheduled game time and server time
- Public display lobby countdown with QR/session code/player count
- Audience/player vote confirmation state: selected card turns green and button changes to Voted ✓
- One vote per voter per voting round
- Typed/finale answer persistence fixes retained
- Recoupling answer persistence fixes retained
- Player names used in prompts/options where possible, while backend values stay me/partner/both/neither
- Session reset hard fix retained
- Cash Out / Double Down retained
- Rolling Island Mode retained

## Notes

For testing, keep Auto Dump off until you trust the flow for the venue. Fully Automated mode still allows the host to pause or take over manually.

## Host Dashboard Update

This build includes a horizontal host dashboard redesign:

- Sticky host status bar with storage, active game, phase, server time, and quick actions.
- Three-column desktop layout:
  - Left: Create Game, Scheduled Games, permanent Host Cleanup.
  - Center: Active session, lobby, round controls, question/submission status, players/couples, answers/votes.
  - Right: Automation/Voting, Host Script/Cues, Rolling Island Mode, Cash Out/Double Down.
- Host Cleanup stays visible even when no active session is selected.
- Delete Completed Sessions now also clears old recoupling choice rows.
- Added Clear Stale Host State for clearing stuck active-session references.

