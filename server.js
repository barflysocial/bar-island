const express = require('express');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST_PIN = process.env.HOST_PIN || '1238';
const DATABASE_URL = process.env.DATABASE_URL;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function id(prefix = 'id') { return `${prefix}_${crypto.randomBytes(5).toString('hex')}`; }
function code() { return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function clean(s = '') { return String(s ?? '').replace(/[<>]/g, '').trim().slice(0, 500); }
function nowIso() { return new Date().toISOString(); }
function hostOnly(req, res, next) {
  const pin = String(req.headers['x-host-pin'] || req.body?.hostPin || '');
  if (pin !== HOST_PIN) return res.status(401).json({ error: 'Host PIN required.' });
  next();
}

const usePostgres = Boolean(DATABASE_URL);
let pool = null;
let memoryDb = { sessions: {} };

if (usePostgres) {
  const needsSsl = process.env.PGSSLMODE === 'require' || /render\.com|amazonaws\.com|railway|supabase/i.test(DATABASE_URL);
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
}

async function initStorage() {
  if (!usePostgres) {
    console.log('DATABASE_URL not set. Using temporary in-memory storage. Host state will reset on server restart.');
    return;
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      data JSONB NOT NULL,
      scheduled_at TIMESTAMPTZ NULL,
      status TEXT NOT NULL DEFAULT 'waiting',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_scheduled_at ON sessions (scheduled_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions (status);

    CREATE TABLE IF NOT EXISTS host_state (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  const check = await pool.query('SELECT current_database() AS database, current_user AS user');
  console.log(`Connected to PostgreSQL. Database tables ready, including host_state. DB=${check.rows[0].database} USER=${check.rows[0].user}`);
}

async function loadDb() {
  if (!usePostgres) return memoryDb;
  const result = await pool.query('SELECT data FROM sessions ORDER BY COALESCE(scheduled_at, created_at) ASC, created_at ASC');
  const sessions = {};
  for (const row of result.rows) sessions[row.data.id] = row.data;
  return { sessions };
}

async function saveSession(session) {
  session.updatedAt = nowIso();
  if (!usePostgres) {
    memoryDb.sessions[session.id] = session;
    return;
  }
  await pool.query(
    `INSERT INTO sessions (id, code, data, scheduled_at, status, updated_at, created_at)
     VALUES ($1, $2, $3::jsonb, $4, $5, NOW(), COALESCE($6, NOW()))
     ON CONFLICT (id) DO UPDATE SET
       code = EXCLUDED.code,
       data = EXCLUDED.data,
       scheduled_at = EXCLUDED.scheduled_at,
       status = EXCLUDED.status,
       updated_at = NOW()`,
    [session.id, session.code, JSON.stringify(session), session.scheduledAt || null, getStatus(session), session.createdAt || null]
  );
}

async function deleteSession(id) {
  if (!usePostgres) {
    delete memoryDb.sessions[id];
    return;
  }
  await pool.query('DELETE FROM sessions WHERE id = $1', [id]);
}

async function getHostState(key) {
  if (!usePostgres) return memoryDb[key] || null;
  const result = await pool.query('SELECT value FROM host_state WHERE key = $1 LIMIT 1', [key]);
  return result.rows[0]?.value || null;
}

async function setHostState(key, value) {
  if (!usePostgres) { memoryDb[key] = value; return; }
  await pool.query(
    `INSERT INTO host_state (key, value, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, JSON.stringify(value)]
  );
}

async function clearActiveSessionIfDeleted(id) {
  const active = await getHostState('activeSessionId');
  if (active?.id === id) await setHostState('activeSessionId', { id: '', updatedAt: nowIso() });
}

async function getSessionById(sessionId) {
  if (!usePostgres) return memoryDb.sessions[sessionId] || null;
  const result = await pool.query('SELECT data FROM sessions WHERE id = $1 LIMIT 1', [sessionId]);
  return result.rows[0]?.data || null;
}

async function getSessionByCodeValue(codeValue) {
  const upper = String(codeValue || '').toUpperCase();
  if (!usePostgres) return Object.values(memoryDb.sessions).find(s => s.code === upper) || null;
  const result = await pool.query('SELECT data FROM sessions WHERE code = $1 LIMIT 1', [upper]);
  return result.rows[0]?.data || null;
}

async function codeExists(codeValue) {
  return Boolean(await getSessionByCodeValue(codeValue));
}

function getStatus(session) {
  if (session.phase === 'ended' || session.status === 'completed') return 'completed';
  if (session.status === 'live' || session.phase !== 'checkin') return 'live';
  if (session.scheduledAt && new Date(session.scheduledAt).getTime() > Date.now()) return 'upcoming';
  return 'waiting';
}
function formatShowtime(session) {
  if (session.showtime) return session.showtime;
  if (!session.scheduledAt) return '';
  return new Date(session.scheduledAt).toLocaleString('en-US', { dateStyle:'medium', timeStyle:'short' });
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
  return Object.entries(counts)
    .map(([coupleId, votes]) => ({ coupleId, coupleName: coupleName(session, coupleId), votes }))
    .sort((a,b)=>b.votes-a.votes);
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
function publicSession(session, viewerId = null) {
  const couples = session.couples.map(c => ({
    ...c,
    players: c.players.map(pid => session.players[pid]).filter(Boolean).map(p => ({
      id:p.id, name:p.name, bio:p.bio, greenFlag:p.greenFlag, redFlag:p.redFlag,
      type:p.type, pickup:p.pickup, status:p.status
    }))
  }));
  const players = Object.values(session.players).map(p => ({
    id:p.id, name:p.name, bio:p.bio, greenFlag:p.greenFlag, redFlag:p.redFlag,
    type:p.type, pickup:p.pickup, status:p.status, coupleId:p.coupleId || null, isViewer: p.id === viewerId
  }));
  const challengeAnswers = Object.values(session.challengeAnswers || {})
    .filter(a => session.phase === 'finale' || session.hostShowAnswers)
    .map(a => ({...a, playerName: session.players[a.playerId]?.name || 'Player', coupleName: coupleName(session, a.coupleId)}));
  return {
    id: session.id,
    code: session.code,
    title: session.title,
    status: getStatus(session),
    phase: session.phase,
    round: session.round,
    runtimeMinutes: session.runtimeMinutes,
    maxPlayers: session.maxPlayers,
    createdAt: session.createdAt,
    scheduledAt: session.scheduledAt || '',
    calendarDate: session.calendarDate || '',
    startTime: session.startTime || '',
    showtime: formatShowtime(session),
    serverTime: nowIso(),
    players,
    couples,
    audienceCount: Object.keys(session.audience || {}).length,
    voteCounts: tallyVotes(session),
    challengeAnswers,
    recouplingRequests: session.recouplingRequests || {},
    winner: session.winner || null,
    currentPrompt: currentPrompt(session),
    rules: session.rules,
    storage: usePostgres ? 'postgres' : 'memory'
  };
}
function makeSession(body = {}) {
  const createdAt = nowIso();
  const scheduledAt = clean(body.scheduledAt || '');
  return {
    id: id('session'),
    code: body.code ? clean(body.code).toUpperCase().slice(0,8) : code(),
    title: clean(body.title || 'Bar Island'),
    status: 'waiting',
    phase: 'checkin',
    round: 0,
    runtimeMinutes: Number(body.runtimeMinutes || 45),
    maxPlayers: Number(body.maxPlayers || 12),
    calendarDate: clean(body.calendarDate || ''),
    startTime: clean(body.startTime || ''),
    scheduledAt,
    showtime: clean(body.showtime || ''),
    createdAt,
    updatedAt: createdAt,
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
  session.status = phase === 'ended' ? 'completed' : 'live';
  const roundMap = { checkin:0, firstCoupling:1, challenge1:2, challenge2:3, vote:4, recoupling:4, finale:5, ended:5 };
  session.round = roundMap[phase] ?? session.round;
  session.votes = {};
  if (['challenge1','challenge2','finale'].includes(phase)) session.challengeAnswers = {};
  if (phase === 'recoupling') session.recouplingRequests = {};
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

app.get('/api/health', asyncHandler(async (req, res) => {
  let db = usePostgres ? 'postgres' : 'memory';
  if (usePostgres) await pool.query('SELECT 1');
  res.json({ ok: true, storage: db, serverTime: nowIso() });
}));
app.get('/api/qr.svg', asyncHandler(async (req, res) => {
  const text = String(req.query.text || `${req.protocol}://${req.get('host')}/`).slice(0, 500);
  const svg = await QRCode.toString(text, { type: 'svg', margin: 1, color: { dark: '#12051f', light: '#ffffff' } });
  res.type('image/svg+xml').send(svg);
}));
app.get('/api/time', (req, res) => res.json({ serverTime: nowIso() }));
app.post('/api/host/login', (req, res) => {
  if (String(req.body.pin || '') !== HOST_PIN) return res.status(401).json({ error: 'Incorrect PIN. Try again.' });
  res.json({ ok: true });
});
app.get('/api/sessions', asyncHandler(async (req, res) => {
  const db = await loadDb();
  const rawSessions = Object.values(db.sessions).sort((a,b)=>{
    const at = a.scheduledAt || a.createdAt;
    const bt = b.scheduledAt || b.createdAt;
    return at.localeCompare(bt);
  });
  let activeState = await getHostState('activeSessionId');
  let activeSessionId = activeState?.id || '';
  if (activeSessionId && !rawSessions.some(s => s.id === activeSessionId)) {
    activeSessionId = '';
    await setHostState('activeSessionId', { id: '', updatedAt: nowIso() });
  }
  if (!activeSessionId && rawSessions.length) {
    const live = rawSessions.find(s => getStatus(s) === 'live');
    const upcoming = rawSessions.find(s => getStatus(s) === 'upcoming' || getStatus(s) === 'waiting');
    activeSessionId = (live || upcoming || rawSessions[0]).id;
    await setHostState('activeSessionId', { id: activeSessionId, updatedAt: nowIso() });
  }
  const sessions = rawSessions.map(s => publicSession(s));
  res.json({ serverTime: nowIso(), storage: usePostgres ? 'postgres' : 'memory', activeSessionId, sessions });
}));
app.post('/api/sessions', hostOnly, asyncHandler(async (req, res) => {
  let session = makeSession(req.body || {});
  while (await codeExists(session.code)) session.code = code();
  await saveSession(session);
  await setHostState('activeSessionId', { id: session.id, updatedAt: nowIso() });
  res.json({ session: publicSession(session), activeSessionId: session.id });
}));
app.get('/api/session/:code', asyncHandler(async (req, res) => {
  const session = await getSessionByCodeValue(req.params.code);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  res.json({ session: publicSession(session, req.query.viewerId) });
}));
app.post('/api/join', asyncHandler(async (req, res) => {
  const session = await getSessionByCodeValue(req.body.code);
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
    joinedAt: nowIso()
  };
  session.players[player.id] = player;
  await saveSession(session);
  res.json({ player, session: publicSession(session, player.id) });
}));
app.post('/api/audience', asyncHandler(async (req, res) => {
  const session = await getSessionByCodeValue(req.body.code);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const audience = { id: id('aud'), name: clean(req.body.name || 'Audience'), joinedAt: nowIso() };
  session.audience[audience.id] = audience;
  await saveSession(session);
  res.json({ audience, session: publicSession(session) });
}));
app.post('/api/host/active', hostOnly, asyncHandler(async (req, res) => {
  const sessionId = clean(req.body.sessionId || '');
  const session = await getSessionById(sessionId);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  await setHostState('activeSessionId', { id: session.id, updatedAt: nowIso() });
  res.json({ ok: true, activeSessionId: session.id, session: publicSession(session) });
}));

app.get('/api/host/state', hostOnly, asyncHandler(async (req, res) => {
  const activeState = await getHostState('activeSessionId');
  const activeSession = activeState?.id ? await getSessionById(activeState.id) : null;
  res.json({
    storage: usePostgres ? 'postgres' : 'memory',
    activeSessionId: activeState?.id || '',
    activeSession: activeSession ? publicSession(activeSession) : null,
    serverTime: nowIso()
  });
}));

app.post('/api/host/:id/phase', hostOnly, asyncHandler(async (req, res) => {
  const session = await getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const phase = clean(req.body.phase);
  if (phase === 'firstCoupling') pairPlayers(session);
  if (phase === 'ended') session.winner = tallyVotes(session)[0] || null;
  advancePhase(session, phase);
  if (phase === 'firstCoupling') { session.phase = 'firstCoupling'; session.round = 1; }
  await saveSession(session);
  await setHostState('activeSessionId', { id: session.id, updatedAt: nowIso() });
  res.json({ session: publicSession(session) });
}));
app.post('/api/host/:id/pair', hostOnly, asyncHandler(async (req, res) => {
  const session = await getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  pairPlayers(session); session.phase = 'firstCoupling'; session.status = 'live'; session.round = 1;
  await saveSession(session);
  await setHostState('activeSessionId', { id: session.id, updatedAt: nowIso() });
  res.json({ session: publicSession(session) });
}));
app.post('/api/host/:id/dump', hostOnly, asyncHandler(async (req, res) => {
  const session = await getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const coupleId = clean(req.body.coupleId);
  const c = session.couples.find(x => x.id === coupleId);
  if (c) c.players.forEach(pid => { if (session.players[pid]) session.players[pid].status = 'dumped'; });
  session.couples = session.couples.filter(x => x.id !== coupleId);
  await saveSession(session);
  await setHostState('activeSessionId', { id: session.id, updatedAt: nowIso() });
  res.json({ session: publicSession(session) });
}));
app.post('/api/host/:id/delete', hostOnly, asyncHandler(async (req, res) => {
  const session = await getSessionById(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  await deleteSession(req.params.id);
  await clearActiveSessionIfDeleted(req.params.id);
  res.json({ ok: true });
}));
app.post('/api/answer', asyncHandler(async (req, res) => {
  const session = await getSessionByCodeValue(req.body.code);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const player = session.players[req.body.playerId];
  if (!player) return res.status(404).json({ error: 'Player not found.' });
  const coupleId = player.coupleId;
  if (!coupleId) return res.status(400).json({ error: 'You are not coupled yet.' });
  session.challengeAnswers[coupleId] = { id: id('answer'), playerId: player.id, coupleId, phase: session.phase, text: clean(req.body.text), createdAt: nowIso() };
  await saveSession(session);
  res.json({ session: publicSession(session, player.id) });
}));
app.post('/api/vote', asyncHandler(async (req, res) => {
  const session = await getSessionByCodeValue(req.body.code);
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
  session.votes[key] = { voterType, voterId, coupleId, phase: session.phase, createdAt: nowIso() };
  await saveSession(session);
  res.json({ session: publicSession(session, voterId) });
}));
app.post('/api/recouple', asyncHandler(async (req, res) => {
  const session = await getSessionByCodeValue(req.body.code);
  if (!session) return res.status(404).json({ error: 'Session not found.' });
  const player = session.players[req.body.playerId];
  if (!player) return res.status(404).json({ error: 'Player not found.' });
  session.recouplingRequests[player.id] = { playerId: player.id, playerName: player.name, choice: clean(req.body.choice), targetPlayerId: clean(req.body.targetPlayerId || ''), createdAt: nowIso() };
  await saveSession(session);
  res.json({ session: publicSession(session, player.id) });
}));

app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public', 'host.html')));
app.get('/public', (req, res) => res.sendFile(path.join(__dirname, 'public', 'public.html')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message || 'Server error.' });
});

initStorage().then(() => {
  app.listen(PORT, '0.0.0.0', () => console.log(`Bar Island running on 0.0.0.0:${PORT}. Storage: ${usePostgres ? 'PostgreSQL' : 'memory'}`));
}).catch(err => {
  console.error('Failed to initialize storage:', err);
  process.exit(1);
});
