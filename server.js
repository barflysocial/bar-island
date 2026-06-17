const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'sessions.json');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ sessions: {} }, null, 2));
}
function load() {
  ensureData();
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { return { sessions: {} }; }
}
function save(db) {
  ensureData();
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
function id(prefix='id') { return `${prefix}_${crypto.randomBytes(5).toString('hex')}`; }
function code() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function clean(s='') { return String(s).replace(/[<>]/g, '').trim().slice(0, 500); }
function publicSession(session, viewerId=null) {
  const couples = session.couples.map(c => ({...c, players: c.players.map(pid => session.players[pid]).filter(Boolean).map(p => ({ id:p.id, name:p.name, bio:p.bio, greenFlag:p.greenFlag, redFlag:p.redFlag, type:p.type, pickup:p.pickup, status:p.status }))}));
  const players = Object.values(session.players).map(p => ({ id:p.id, name:p.name, bio:p.bio, greenFlag:p.greenFlag, redFlag:p.redFlag, type:p.type, pickup:p.pickup, status:p.status, coupleId:p.coupleId || null, isViewer: p.id === viewerId }));
  const audienceCount = Object.keys(session.audience || {}).length;
  const voteCounts = tallyVotes(session);
  const challengeAnswers = Object.values(session.challengeAnswers || {}).filter(a => session.phase === 'finale' || session.hostShowAnswers).map(a => ({...a, playerName: session.players[a.playerId]?.name || 'Player', coupleName: coupleName(session, a.coupleId)}));
  return {
    id: session.id,
    code: session.code,
    title: session.title,
    status: session.status,
    phase: session.phase,
    round: session.round,
    runtimeMinutes: session.runtimeMinutes,
    maxPlayers: session.maxPlayers,
    createdAt: session.createdAt,
    showtime: session.showtime,
    players,
    couples,
    audienceCount,
    voteCounts,
    challengeAnswers,
    recouplingRequests: session.recouplingRequests || {},
    winner: session.winner || null,
    currentPrompt: currentPrompt(session),
    rules: session.rules
  };
}
function currentPrompt(session) {
  const prompts = {
    checkin: 'Create a funny islander profile and wait for the host to start.',
    firstCoupling: 'First Impressions: couples are forming. Make your best first impression.',
    challenge1: 'Couple Challenge: answer the prompt with your partner. The crowd votes after answers are revealed.',
    challenge2: 'Spill the Tea: submit your funniest or boldest answer as a couple.',
    vote: 'Audience Vote: players vote for another couple. Audience voters can vote for anyone.',
    recoupling: 'Recoupling: stay loyal, switch, or become single. No couple is fully safe.',
    finale: 'Finale: final couples make one last pitch. The crowd chooses Bar Island Champions.',
    ended: 'Game ended. Congratulations to the Bar Island Champions.'
  };
  const challengePrompts = [
    'What makes your couple the strongest connection in the bar?',
    'What is your couple red flag, and why should the crowd ignore it?',
    'Give your best 15-second pitch for why you should win Bar Island.'
  ];
  if (session.phase === 'challenge1') return challengePrompts[0];
  if (session.phase === 'challenge2') return challengePrompts[1];
  if (session.phase === 'finale') return challengePrompts[2];
  return prompts[session.phase] || prompts.checkin;
}
function coupleName(session, cid) {
  const c = session.couples.find(x => x.id === cid);
  if (!c) return 'Single';
  const names = c.players.map(pid => session.players[pid]?.name).filter(Boolean);
  return names.length ? names.join(' + ') : c.name;
}
function tallyVotes(session) {
  const counts = {};
  for (const c of session.couples) counts[c.id] = 0;
  for (const v of Object.values(session.votes || {})) {
    if (counts[v.coupleId] !== undefined) counts[v.coupleId]++;
  }
  return Object.entries(counts).map(([coupleId, votes]) => ({ coupleId, coupleName: coupleName(session, coupleId), votes })).sort((a,b)=>b.votes-a.votes);
}
function getSessionByCode(db, c) {
  return Object.values(db.sessions).find(s => s.code === String(c || '').toUpperCase());
}
function makeSession(body={}) {
  const now = new Date().toISOString();
  return {
    id: id('session'),
    code: body.code ? clean(body.code).toUpperCase().slice(0,8) : code(),
    title: clean(body.title || 'Bar Island: Coupled Up'),
    status: 'waiting',
    phase: 'checkin',
    round: 0,
    runtimeMinutes: Number(body.runtimeMinutes || 45),
    maxPlayers: Number(body.maxPlayers || 12),
    showtime: clean(body.showtime || ''),
    createdAt: now,
    updatedAt: now,
    players: {},
    audience: {},
    couples: [],
    votes: {},
    challengeAnswers: {},
    recouplingRequests: {},
    hostShowAnswers: true,
    winner: null,
    rules: {
      playersCannotVoteOwnCouple: true,
      audienceCanVoteAnyCouple: true,
      maxCouples: 6,
      minPlayers: 6,
      idealPlayers: 10
    }
  };
}
function pairPlayers(session) {
  const active = Object.values(session.players).filter(p => p.status !== 'dumped');
  active.forEach(p => p.coupleId = null);
  const shuffled = [...active].sort((a,b) => a.joinedAt.localeCompare(b.joinedAt));
  const couples = [];
  while (shuffled.length) {
    const a = shuffled.shift();
    const b = shuffled.shift();
    const cid = id('couple');
    const players = b ? [a.id, b.id] : [a.id];
    players.forEach(pid => session.players[pid].coupleId = cid);
    couples.push({ id: cid, name: players.map(pid => session.players[pid].name).join(' + ') || 'New Couple', players, safe: false });
  }
  session.couples = couples;
}
function advancePhase(session, phase) {
  session.phase = phase;
  session.status = phase === 'ended' ? 'ended' : 'live';
  const roundMap = { checkin:0, firstCoupling:1, challenge1:2, challenge2:3, vote:4, recoupling:4, finale:5, ended:5 };
  session.round = roundMap[phase] ?? session.round;
  session.votes = {};
  if (['challenge1','challenge2','finale'].includes(phase)) session.challengeAnswers = {};
  if (phase === 'recoupling') session.recouplingRequests = {};
  session.updatedAt = new Date().toISOString();
}

app.get('/api/sessions', (req, res) => {
  const db = load();
  const sessions = Object.values(db.sessions).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(s => publicSession(s));
  res.json({ sessions });
});
app.post('/api/sessions', (req, res) => {
  const db = load();
  let session = makeSession(req.body || {});
  while (getSessionByCode(db, session.code)) session.code = code();
  db.sessions[session.id] = session;
  save(db);
  res.json({ session: publicSession(session) });
});
app.get('/api/session/:code', (req, res) => {
  const db = load();
  const session = getSessionByCode(db, req.params.code);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  res.json({ session: publicSession(session, req.query.viewerId) });
});
app.post('/api/join', (req, res) => {
  const db = load();
  const session = getSessionByCode(db, req.body.code);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const existing = Object.values(session.players).find(p => p.phone && p.phone === clean(req.body.phone));
  if (existing) return res.json({ player: existing, session: publicSession(session, existing.id) });
  const activeCount = Object.values(session.players).filter(p => p.status !== 'dumped').length;
  if (activeCount >= session.maxPlayers) return res.status(400).json({ error: 'This island is full.' });
  const player = {
    id: id('player'),
    name: clean(req.body.name || 'Islander'),
    phone: clean(req.body.phone || ''),
    bio: clean(req.body.bio || ''),
    type: clean(req.body.type || ''),
    greenFlag: clean(req.body.greenFlag || ''),
    redFlag: clean(req.body.redFlag || ''),
    pickup: clean(req.body.pickup || ''),
    status: 'active',
    coupleId: null,
    joinedAt: new Date().toISOString()
  };
  session.players[player.id] = player;
  session.updatedAt = new Date().toISOString();
  save(db);
  res.json({ player, session: publicSession(session, player.id) });
});
app.post('/api/audience', (req, res) => {
  const db = load();
  const session = getSessionByCode(db, req.body.code);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const audience = { id: id('aud'), name: clean(req.body.name || 'Audience'), joinedAt: new Date().toISOString() };
  session.audience[audience.id] = audience;
  save(db);
  res.json({ audience, session: publicSession(session) });
});
app.post('/api/host/:id/phase', (req, res) => {
  const db = load(); const session = db.sessions[req.params.id];
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const phase = clean(req.body.phase);
  if (phase === 'firstCoupling') pairPlayers(session);
  if (phase === 'ended') {
    const top = tallyVotes(session)[0];
    session.winner = top || null;
  }
  advancePhase(session, phase);
  if (phase === 'firstCoupling') { session.phase = 'firstCoupling'; session.round = 1; }
  save(db); res.json({ session: publicSession(session) });
});
app.post('/api/host/:id/pair', (req, res) => {
  const db = load(); const session = db.sessions[req.params.id];
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  pairPlayers(session); session.phase = 'firstCoupling'; session.status = 'live'; session.round = 1; session.updatedAt = new Date().toISOString();
  save(db); res.json({ session: publicSession(session) });
});
app.post('/api/host/:id/dump', (req, res) => {
  const db = load(); const session = db.sessions[req.params.id];
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const coupleId = clean(req.body.coupleId);
  const c = session.couples.find(x => x.id === coupleId);
  if (c) c.players.forEach(pid => { if (session.players[pid]) session.players[pid].status = 'dumped'; });
  session.couples = session.couples.filter(x => x.id !== coupleId);
  save(db); res.json({ session: publicSession(session) });
});
app.post('/api/host/:id/delete', (req, res) => {
  const db = load();
  if (!db.sessions[req.params.id]) return res.status(404).json({ error: 'Session not found.' });
  delete db.sessions[req.params.id]; save(db); res.json({ ok: true });
});
app.post('/api/answer', (req, res) => {
  const db = load(); const session = getSessionByCode(db, req.body.code);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const player = session.players[req.body.playerId];
  if (!player) return res.status(404).json({ error: 'Player not found.' });
  const coupleId = player.coupleId;
  if (!coupleId) return res.status(400).json({ error: 'You are not coupled yet.' });
  session.challengeAnswers[coupleId] = { id: id('answer'), playerId: player.id, coupleId, phase: session.phase, text: clean(req.body.text), createdAt: new Date().toISOString() };
  save(db); res.json({ session: publicSession(session, player.id) });
});
app.post('/api/vote', (req, res) => {
  const db = load(); const session = getSessionByCode(db, req.body.code);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const voterType = clean(req.body.voterType || 'audience');
  const voterId = clean(req.body.voterId || '');
  const coupleId = clean(req.body.coupleId);
  if (!session.couples.some(c => c.id === coupleId)) return res.status(400).json({ error: 'Couple not found.' });
  if (voterType === 'player') {
    const p = session.players[voterId];
    if (!p) return res.status(404).json({ error: 'Player not found.' });
    if (session.rules.playersCannotVoteOwnCouple && p.coupleId === coupleId) return res.status(400).json({ error: 'Islanders cannot vote for themselves or their own couple.' });
  }
  const key = `${voterType}_${voterId}_${session.phase}`;
  session.votes[key] = { voterType, voterId, coupleId, phase: session.phase, createdAt: new Date().toISOString() };
  save(db); res.json({ session: publicSession(session, voterId) });
});
app.post('/api/recouple', (req, res) => {
  const db = load(); const session = getSessionByCode(db, req.body.code);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const player = session.players[req.body.playerId];
  if (!player) return res.status(404).json({ error: 'Player not found.' });
  session.recouplingRequests[player.id] = { playerId: player.id, playerName: player.name, choice: clean(req.body.choice), targetPlayerId: clean(req.body.targetPlayerId || ''), createdAt: new Date().toISOString() };
  save(db); res.json({ session: publicSession(session, player.id) });
});

app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => console.log(`Bar Island running on 0.0.0.0:${PORT}`));
