const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const HOST_PIN = process.env.HOST_PIN || '1238';

const DB_ENV_CANDIDATES = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRESQL_URL',
  'INTERNAL_DATABASE_URL',
  'DATABASE_INTERNAL_URL',
  'RENDER_DATABASE_URL',
  'DB_URL'
];
function cleanDbUrl(value){
  if (!value || typeof value !== 'string') return '';
  return value.trim().replace(/^['\"]|['\"]$/g, '');
}
const DATABASE_URL_KEY = DB_ENV_CANDIDATES.find(k => cleanDbUrl(process.env[k]));
const DATABASE_URL = cleanDbUrl(DATABASE_URL_KEY ? process.env[DATABASE_URL_KEY] : '');
function hasPgParts(){ return !!(process.env.PGHOST && process.env.PGDATABASE && process.env.PGUSER && process.env.PGPASSWORD); }
function dbDiagnostic(){
  return {
    storage: pool ? 'postgres' : 'memory',
    databaseUrlKey: DATABASE_URL_KEY || null,
    databaseUrlPresent: !!DATABASE_URL,
    pgPartsPresent: hasPgParts(),
    checkedKeys: DB_ENV_CANDIDATES,
    message: pool ? `Connected using ${DATABASE_URL_KEY || 'PGHOST/PGDATABASE/PGUSER'}` : 'No database connection available in this running service.'
  };
}

let pool = null;
let memory = { sessions: {}, hostState: { activeSessionId: null } };

const QUESTION_POOL = [
  { id:'anon1', theme:'anonymous', type:'typed', text:'What is one green flag that immediately makes you interested in someone?' },
  { id:'anon2', theme:'anonymous', type:'typed', text:'Describe your perfect first date in one sentence.' },
  { id:'anon3', theme:'anonymous', type:'typed', text:'What is something small someone can do that makes you feel seen?' },
  { id:'anon4', theme:'anonymous', type:'typed', text:'What kind of energy do you bring into a relationship?' },
  { id:'anon5', theme:'anonymous', type:'typed', text:'What is your most underrated dating quality?' },
  { id:'anon6', theme:'anonymous', type:'typed', text:'Finish this: I know there is chemistry when...' },
  { id:'anon7', theme:'anonymous', type:'typed', text:'What makes someone go from cute to unforgettable?' },
  { id:'anon8', theme:'anonymous', type:'typed', text:'What is a low-pressure way someone can show they are interested?' },
  { id:'chem1', theme:'chemistry', type:'choice', text:'What matters most on a first date?', options:['Good conversation','Shared humor','Physical attraction','Emotional maturity'] },
  { id:'chem2', theme:'chemistry', type:'choice', text:'Someone you like takes a while to text back. What do you do?', options:['Give them space','Ask directly','Match their energy','Lose interest'] },
  { id:'chem3', theme:'chemistry', type:'choice', text:'Which first-date plan sounds most like you?', options:['Coffee and conversation','Live music or karaoke','Dinner somewhere cozy','Something competitive and playful'] },
  { id:'chem4', theme:'chemistry', type:'choice', text:'What makes you feel most connected to someone?', options:['Feeling heard','Laughing together','Physical chemistry','Shared goals'] },
  { id:'chem5', theme:'chemistry', type:'choice', text:'Your date is getting attention from someone else. What is your reaction?', options:['Trust them','Observe quietly','Make my presence known','Get turned off'] },
  { id:'chem6', theme:'chemistry', type:'choice', text:'What is your dating pace?', options:['Slow burn','Clear and direct','Flirty and spontaneous','Friends first'] },
  { id:'spark1', theme:'spark', type:'choice', text:'Who would you want another conversation with after tonight?', options:['interested','maybe','friend','not_match'] },
  { id:'spark2', theme:'spark', type:'choice', text:'What kind of spark are you open to tonight?', options:['Real connection','Fun flirtation','Friend vibes','Surprise me'] },
  { id:'couple_written1', theme:'couple_written', type:'typed', text:'Together, plan your ideal first date in one sentence.' },
  { id:'couple_written2', theme:'couple_written', type:'typed', text:'Why does this match have chemistry?' },
  { id:'couple_written3', theme:'couple_written', type:'typed', text:'What would make the audience believe in this connection?' },
  { id:'couple_challenge1', theme:'couple_challenge', type:'choice', text:'What would your match say matters most in a relationship?', options:['Communication','Trust','Humor','Consistency'] },
  { id:'couple_challenge2', theme:'couple_challenge', type:'choice', text:'Who is more likely to plan the next date?', options:['me','partner','both','neither'] },
  { id:'couple_challenge3', theme:'couple_challenge', type:'choice', text:'What is your couple energy?', options:['Sweet','Funny','Spicy','Unexpected'] },
  { id:'fin1', theme:'finale', type:'typed', text:'Why should the audience crown your couple Bar Island Champions?' },
  { id:'fin2', theme:'finale', type:'typed', text:'What did the crowd get to see in your connection tonight?' }
];

const PHASES = [
  'lobby','first_impressions','redflag','audience_vote','chemistry','temptation','audience_vote','couple_up','mingle','survival','spill','audience_vote','recoupling','finale_pitch','final_winner_vote','winner'
];
const PHASE_LABELS = {
  lobby:'Lobby', first_impressions:'Blind Date Swipe', couple_up:'Match Reveal', mingle:'Couple Mingle', redflag:'Anonymous Chemistry Answer', chemistry:'Chemistry Choice', spill:'Couple Written Answer', temptation:'Mutual Spark Vote', recoupling:'Stay Together or Switch?', survival:'Couple Chemistry Challenge', audience_vote:'Audience Voting', finale_pitch:'Final Chemistry Pitch', final_winner_vote:'Final Winner Vote', winner:'Winner Reveal', cashout:'Cash Out or Double Down', replacement:'Replacement Teams'
};

function id(prefix='id'){ return prefix + '_' + crypto.randomBytes(6).toString('hex'); }
function code(){ return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function nowIso(){ return new Date().toISOString(); }
function msLeft(endsAt){ return endsAt ? Math.max(0, new Date(endsAt).getTime() - Date.now()) : 0; }
const DEFAULT_EVENT_TIMEZONE = process.env.EVENT_TIMEZONE || 'America/Chicago';
function pad2(n){ return String(n).padStart(2,'0'); }
function splitLocalDateTime(value){
  const raw = String(value || '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return { year:+m[1], month:+m[2], day:+m[3], hour:+(m[4]||0), minute:+(m[5]||0), second:+(m[6]||0) };
}
function getTimeZoneOffsetMs(date, timeZone){
  const dtf = new Intl.DateTimeFormat('en-US',{ timeZone, hour12:false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const parts = Object.fromEntries(dtf.formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month-1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - date.getTime();
}
function localDateTimeToUtcIso(value, timeZone=DEFAULT_EVENT_TIMEZONE){
  if (!value) return new Date(Date.now()+10*60000).toISOString();
  const raw = String(value).trim();
  // If the browser/server sends an explicit offset or Z, trust that exact instant.
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) return new Date(raw).toISOString();
  const c = splitLocalDateTime(raw);
  if (!c) return new Date(raw).toISOString();
  const guess = new Date(Date.UTC(c.year,c.month-1,c.day,c.hour,c.minute,c.second));
  const offset = getTimeZoneOffsetMs(guess, timeZone);
  return new Date(guess.getTime() - offset).toISOString();
}
function formatLocalInputFromUtc(iso, timeZone=DEFAULT_EVENT_TIMEZONE){
  if (!iso) return '';
  const d = new Date(iso);
  const dtf = new Intl.DateTimeFormat('en-US',{ timeZone, hour12:false, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
  const parts = Object.fromEntries(dtf.formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
function formatEventTime(iso, timeZone=DEFAULT_EVENT_TIMEZONE){
  if (!iso) return '';
  return new Intl.DateTimeFormat('en-US',{ timeZone, dateStyle:'medium', timeStyle:'short' }).format(new Date(iso));
}
function durationFor(phase){
  if (phase === 'lobby') return 0;
  if (phase === 'mingle') return 5*60;
  if (phase === 'audience_vote') return 2*60;
  if (phase === 'final_winner_vote') return 5*60;
  if (phase === 'cashout') return 60;
  if (phase === 'recoupling') return 45;
  if (phase === 'finale_pitch') return 90;
  if (['redflag','spill'].includes(phase)) return 60;
  if (['chemistry','temptation','survival'].includes(phase)) return 45;
  return 60;
}
function publicSession(s){ return s; }

async function initDb(){
  if (!DATABASE_URL && !hasPgParts()) {
    console.warn('No Postgres environment variables found. Checked:', DB_ENV_CANDIDATES.join(', '), 'and PGHOST/PGDATABASE/PGUSER/PGPASSWORD. Using memory storage.');
    return;
  }
  if (DATABASE_URL) {
    pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized:false } });
  } else {
    pool = new Pool({
      host: process.env.PGHOST,
      port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
      database: process.env.PGDATABASE,
      user: process.env.PGUSER,
      password: process.env.PGPASSWORD,
      ssl: { rejectUnauthorized:false }
    });
  }

  // Database schema hard-fix/migration. Older Bar Island builds created host_state
  // with a different shape, which caused: column "id" of relation "host_state" does not exist.
  // host_state only stores the active host pointer, so it is safe to rebuild.
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE,
    status TEXT,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  const hostStateInfo = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'host_state'
  `);
  const cols = hostStateInfo.rows.map(r => r.column_name);
  const needsHostStateRebuild = cols.length > 0 && (!cols.includes('id') || !cols.includes('data'));
  if (needsHostStateRebuild) {
    console.log('Migrating host_state table to current schema...');
    await pool.query(`DROP TABLE IF EXISTS host_state`);
  }

  await pool.query(`CREATE TABLE IF NOT EXISTS host_state (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{"activeSessionId":null}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
  await pool.query(`INSERT INTO host_state (id,data)
    VALUES ('main','{"activeSessionId":null}'::jsonb)
    ON CONFLICT (id) DO NOTHING`);

  // Clean up invalid active pointers so an old completed/deleted session is not reselected.
  await pool.query(`UPDATE host_state
    SET data = jsonb_set(data, '{activeSessionId}', 'null'::jsonb), updated_at = NOW()
    WHERE id='main'
      AND (data->>'activeSessionId') IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM sessions WHERE sessions.id = data->>'activeSessionId')`);

  const dbInfo = await pool.query(`SELECT current_database() AS database, current_user AS username`);
  console.log(`Connected to PostgreSQL using ${DATABASE_URL_KEY || 'PGHOST/PGDATABASE/PGUSER'}. Database migrated successfully. DB=${dbInfo.rows[0].database} USER=${dbInfo.rows[0].username}`);
}
async function getHostState(){
  if (!pool) return memory.hostState;
  const r = await pool.query(`SELECT data FROM host_state WHERE id='main'`);
  return r.rows[0]?.data || { activeSessionId:null };
}
async function setHostState(data){
  if (!pool){ memory.hostState = data; return; }
  await pool.query(`UPDATE host_state SET data=$1, updated_at=NOW() WHERE id='main'`, [data]);
}
async function listSessions(){
  if (!pool) return Object.values(memory.sessions).sort((a,b)=>(a.startTime||'').localeCompare(b.startTime||''));
  const r = await pool.query(`SELECT data FROM sessions ORDER BY updated_at DESC`);
  return r.rows.map(x=>x.data);
}
async function saveSession(s){
  s.updatedAt = nowIso();
  if (!pool){ memory.sessions[s.id] = s; return s; }
  await pool.query(`INSERT INTO sessions (id,code,status,data,updated_at) VALUES ($1,$2,$3,$4,NOW()) ON CONFLICT (id) DO UPDATE SET status=$3,data=$4,updated_at=NOW()`, [s.id,s.code,s.status,s]);
  return s;
}
async function getSessionById(idv){
  if (!idv) return null;
  if (!pool) return memory.sessions[idv] || null;
  const r = await pool.query(`SELECT data FROM sessions WHERE id=$1`, [idv]);
  return r.rows[0]?.data || null;
}
async function getSessionByCode(c){
  if (!c) return null;
  const sessions = await listSessions();
  return sessions.find(s => s.code === c.toUpperCase()) || null;
}
async function deleteCompleted(){
  const sessions = await listSessions();
  const completed = sessions.filter(s => ['completed','ended','cleared'].includes(s.status));
  if (!pool){ completed.forEach(s=>delete memory.sessions[s.id]); }
  else { for (const s of completed) await pool.query(`DELETE FROM sessions WHERE id=$1`, [s.id]); }
  const hs = await getHostState();
  if (completed.some(s=>s.id===hs.activeSessionId)) await setHostState({ activeSessionId:null });
  return completed.length;
}
async function deleteSessionById(sessionId){
  if (!sessionId) return false;
  const s = await getSessionById(sessionId);
  if (!s) return false;
  if (!pool) delete memory.sessions[sessionId];
  else await pool.query(`DELETE FROM sessions WHERE id=$1`, [sessionId]);
  const hs = await getHostState();
  if (hs.activeSessionId === sessionId) await setHostState({ activeSessionId:null });
  return true;
}

function pickQuestions(){
  const by = (t,n=4) => QUESTION_POOL.filter(q=>q.theme===t).sort(()=>Math.random()-.5).slice(0,n);
  return [...by('anonymous',4), ...by('chemistry',4), ...by('spark',2), ...by('couple_written',3), ...by('couple_challenge',3), ...by('finale',2)];
}
function createSession(body){
  const eventTimezone = body.eventTimezone || DEFAULT_EVENT_TIMEZONE;
  const startTime = localDateTimeToUtcIso(body.startTime, eventTimezone);
  return {
    id:id('session'), code: code(), title: body.title || 'Bar Island', venue: body.venue || '', voteIframeUrl: body.voteIframeUrl || '', requirePlayerPhoto: body.requirePlayerPhoto !== false, startTime, startTimeUtc:startTime, eventTimezone, startTimeLocal: formatLocalInputFromUtc(startTime, eventTimezone), startTimeDisplay: formatEventTime(startTime, eventTimezone),
    status:'upcoming', phase:'lobby', phaseIndex:0, phaseInstanceId:id('phase'), phaseStartedAt:null, phaseEndsAt:startTime,
    gameStartedAt:null, gameClockPausedMs:0, isPaused:false, automationMode: body.automationMode || 'manual', autoDump: !!body.autoDump,
    gameLengthHours: Number(body.gameLengthHours || 1), blockIndex:1, maxBlocks:Number(body.gameLengthHours || 1), maxCouples:6,
    players:[], audience:[], couples:[], votes:[], answers:[], recouplingChoices:[], finalePitches:[], cashoutChoices:[], reactions:[], predictions:[], audienceQuestions:[], comfortRequests:[], suggestedMatches:[], matchReviewApproved:false, revealAnswerWriters:true,
    questionSet: pickQuestions(), currentQuestionIndex:0, currentVoteKey:null, voteLocked:false, resultsRevealed:false,
    cashoutPrizes:{ block1: body.cashoutPrize1 || '', block2: body.cashoutPrize2 || '', final: body.finalPrize || '' }, finalPrizeRevealed:false,
    replacementOpen:false, replacementSlots:0, completedBlocks:[], winnerCoupleId:null,
    createdAt:nowIso(), updatedAt:nowIso()
  };
}
function phaseQuestion(s){
  const theme = s.phase === 'redflag' ? 'anonymous' : s.phase === 'chemistry' ? 'chemistry' : s.phase === 'spill' ? 'couple_written' : s.phase === 'temptation' ? 'spark' : s.phase === 'survival' ? 'couple_challenge' : s.phase === 'finale_pitch' ? 'finale' : null;
  if (!theme) return null;
  const qs = s.questionSet.filter(q=>q.theme===theme);
  return qs[(s.currentQuestionIndex||0) % Math.max(1,qs.length)] || null;
}

function sparkWeight(choice){ return {interested:3, maybe:2, friend:1, not_match:0}[choice] ?? 0; }
function pairScore(s,a,b){
  const sparks=s.sparkVotes||[];
  const ab=sparks.find(x=>x.playerId===a.id && x.targetPlayerId===b.id);
  const ba=sparks.find(x=>x.playerId===b.id && x.targetPlayerId===a.id);
  const mutual=Math.min(sparkWeight(ab?.choice), sparkWeight(ba?.choice))*10;
  const bonus=(sparkWeight(ab?.choice)+sparkWeight(ba?.choice))*2;
  const answerBonus = compatibilityAnswerBonus(s,a.id,b.id);
  return mutual+bonus+answerBonus;
}
function compatibilityAnswerBonus(s,aId,bId){
  const ans=s.answers||[];
  let bonus=0;
  const byQ={};
  ans.filter(a=>a.playerId===aId||a.playerId===bId).forEach(a=>{ byQ[a.questionId]=byQ[a.questionId]||{}; byQ[a.questionId][a.playerId]=a; });
  Object.values(byQ).forEach(pair=>{ if(pair[aId]&&pair[bId]&&pair[aId].value===pair[bId].value) bonus+=3; });
  return bonus;
}
const COUPLE_NAMES=['Team Spark','The Plot Twist','The Green Flags','The Wild Cards','The Main Characters','The Slow Burn','The Vibe Check','The Chemistry Set','The Palm Hearts','The Fireflies','The Day Ones','The Good Energy Duo'];
function coupleTeamName(i){ return COUPLE_NAMES[i % COUPLE_NAMES.length]; }
function matchReasonFor(score){
  if(score>=40) return 'Strong mutual spark + matching chemistry answers';
  if(score>=25) return 'Mutual curiosity + strong blind-date energy';
  if(score>=12) return 'Shared interest + audience-friendly chemistry';
  if(score>0) return 'Promising connection from blind-date votes';
  return 'Best available personality-first match';
}
function buildSuggestedMatches(s){
  const singles=(s.players||[]).filter(p=>p.status==='active' && p.matchEligible!==false);
  const pairs=[];
  for(let i=0;i<singles.length;i++) for(let j=i+1;j<singles.length;j++) pairs.push({a:singles[i],b:singles[j],score:pairScore(s,singles[i],singles[j])});
  pairs.sort((x,y)=>y.score-x.score);
  const used=new Set(); const suggestions=[];
  for(const pair of pairs){
    if(used.has(pair.a.id)||used.has(pair.b.id)) continue;
    if(suggestions.length>=s.maxCouples) break;
    used.add(pair.a.id); used.add(pair.b.id);
    suggestions.push({ id:id('match'), playerIds:[pair.a.id,pair.b.id], score:pair.score||0, reason:matchReasonFor(pair.score||0), coupleName:coupleTeamName(suggestions.length), approved:true });
  }
  const unmatched=singles.filter(p=>!used.has(p.id)).map(p=>p.id);
  s.suggestedMatches=suggestions;
  s.unmatchedPlayerIds=unmatched;
  s.matchReviewApproved=false;
  s.matchReviewCreatedAt=nowIso();
  return suggestions;
}
function ensureAudienceFromPlayer(s,p,role='Island Audience'){
  if(!p) return null;
  s.audience=s.audience||[];
  let a=s.audience.find(x=>x.playerId===p.id || x.id===p.audienceId);
  if(!a){
    a={id:id('aud'), playerId:p.id, nickname:p.name||'Island Fan', points:0, role, joinedAt:nowIso(), convertedFromPlayer:true};
    s.audience.push(a);
  } else { a.role=role; a.convertedFromPlayer=true; }
  p.audienceId=a.id;
  return a;
}
function applyApprovedMatches(s){
  const suggestions=(s.suggestedMatches||[]).filter(m=>m.approved!==false && (m.playerIds||[]).length===2);
  s.couples=s.couples||[];
  // Remove previous preview/active couples from this reveal to avoid duplicates.
  s.couples=s.couples.filter(c=>!(c.createdBy==='match_review' && c.status==='active'));
  const matched=new Set();
  suggestions.forEach((m,i)=>{
    const ids=m.playerIds.filter(pid=>!matched.has(pid));
    if(ids.length!==2) return;
    matched.add(ids[0]); matched.add(ids[1]);
    s.couples.push({ id:id('couple'), playerIds:ids, status:'active', points:m.score||0, matchReason:m.reason||matchReasonFor(m.score||0), coupleName:m.coupleName||coupleTeamName(i), awardBadges:[], createdBy:'match_review', createdAt:nowIso() });
  });
  const activePlayers=(s.players||[]).filter(p=>p.status==='active');
  const unmatched=activePlayers.filter(p=>!matched.has(p.id));
  unmatched.forEach((p,idx)=>{
    p.status='audience_converted';
    p.convertedAt=nowIso();
    p.convertedReason='match_reveal';
    p.role= idx===0 && unmatched.length % 2 === 1 ? 'Island Judge' : 'Island Audience';
    ensureAudienceFromPlayer(s,p,p.role);
  });
  s.unmatchedPlayerIds=unmatched.map(p=>p.id);
  s.matchReviewApproved=true;
  s.matchReviewApprovedAt=nowIso();
}
function autoPairByMutual(s){
  if ((s.couples||[]).some(c=>c.status==='active')) return;
  if (!(s.suggestedMatches||[]).length) buildSuggestedMatches(s);
  if (s.matchReviewApproved) applyApprovedMatches(s);
}
function startPhase(s, phase, opts={}){
  const entering = s.phase !== phase || opts.forceNew;
  s.phase = phase;
  if (entering) {
    s.phaseInstanceId = id('phase');
    s.phaseStartedAt = nowIso();
    const dur = opts.durationSec ?? durationFor(phase);
    s.phaseEndsAt = dur ? new Date(Date.now()+dur*1000).toISOString() : null;
    if (!opts.keepVotes && (phase === 'audience_vote' || phase === 'final_winner_vote')) {
      s.currentVoteKey = id('vote'); s.voteLocked = false; s.resultsRevealed = false;
    }
    if (['redflag','chemistry','spill','temptation','survival','finale_pitch'].includes(phase)) {
      s.currentQuestionId = phaseQuestion(s)?.id || null;
    }
    if (phase === 'couple_up') { if (!(s.suggestedMatches||[]).length || opts.forceNew) buildSuggestedMatches(s); s.phaseEndsAt=null; }
    if (phase === 'cashout') s.cashoutRoundId = id('cashout');
  }
  return s;
}
function nextPhase(s){
  const order = ['first_impressions','redflag','audience_vote','chemistry','temptation','audience_vote','couple_up','mingle','survival','spill','audience_vote','recoupling','finale_pitch','final_winner_vote','winner'];
  let i = order.indexOf(s.phase);
  if (i < 0) i = -1;
  let n = order[i+1] || 'winner';
  if (s.phase === 'audience_vote') {
    const lastChallenge = s.lastChallengePhase || 'redflag';
    if (lastChallenge === 'redflag') n = 'chemistry';
    else if (lastChallenge === 'temptation') n = 'couple_up';
    else if (lastChallenge === 'spill') n = 'recoupling';
    else if (lastChallenge === 'survival') n = 'spill';
  }
  return n;
}
function teamVotes(s){
  const key = s.currentVoteKey;
  const counts = {};
  s.votes.filter(v=>!key || v.voteKey===key).forEach(v=>{ counts[v.targetCoupleId]=(counts[v.targetCoupleId]||0)+1; });
  return counts;
}
function rankCouples(s){
  const counts = teamVotes(s);
  return s.couples.filter(c=>c.status==='active').sort((a,b)=>(counts[b.id]||0)-(counts[a.id]||0));
}
function shouldCashoutOrReplace(s){ return s.gameLengthHours > 1 && s.blockIndex < s.maxBlocks; }
function dropLowestHalf(s){
  const active = rankCouples(s);
  const dropCount = Math.floor(active.length / 2);
  const dropped = active.slice(-dropCount);
  dropped.forEach(c=>{ c.status='eliminated'; c.eliminatedAt=nowIso(); });
  s.replacementOpen = true;
  s.replacementSlots = dropped.length;
  return dropped;
}
function dropAllButTopOne(s){
  const active = rankCouples(s);
  active.slice(1).forEach(c=>{ c.status='eliminated'; c.eliminatedAt=nowIso(); });
  s.winnerCoupleId = active[0]?.id || null;
  s.status = 'completed';
  startPhase(s,'winner',{forceNew:true});
}
function handleBlockEnd(s){
  if (s.gameLengthHours === 1) return dropAllButTopOne(s);
  if (s.blockIndex < s.maxBlocks) {
    const top = rankCouples(s).slice(0,3);
    s.returningTop3 = top.map(c=>c.id);
    startPhase(s, 'cashout', { forceNew:true, durationSec:60 });
  } else {
    dropAllButTopOne(s);
  }
}
function applyCashoutsAndContinue(s){
  const top3 = s.returningTop3 || [];
  const choices = s.cashoutChoices.filter(x=>x.cashoutRoundId===s.cashoutRoundId);
  top3.forEach(cid=>{
    const cashed = choices.some(x=>x.coupleId===cid && x.choice==='cashout');
    const c = s.couples.find(c=>c.id===cid);
    if (c && cashed) { c.status='cashed_out'; c.cashedOutAt=nowIso(); }
  });
  const still = s.couples.filter(c=>c.status==='active').length;
  s.replacementOpen = true;
  s.replacementSlots = Math.max(0, s.maxCouples - still);
  s.completedBlocks.push({ block:s.blockIndex, endedAt:nowIso(), top3, cashoutRoundId:s.cashoutRoundId });
  s.blockIndex += 1;
  s.currentQuestionIndex = 0;
  startPhase(s, 'replacement', { forceNew:true, durationSec:0 });
}
function autoTick(s){
  if (s.isPaused || s.automationMode !== 'auto') return s;
  if (s.phase === 'lobby' && new Date(s.startTime).getTime() <= Date.now()) {
    s.status='live'; s.gameStartedAt = s.gameStartedAt || nowIso(); startPhase(s, 'first_impressions', { forceNew:true, durationSec:300 });
  }
  if (s.phaseEndsAt && msLeft(s.phaseEndsAt) === 0 && s.status !== 'completed') {
    if (s.phase === 'audience_vote' || s.phase === 'final_winner_vote') {
      s.voteLocked = true;
      if (s.phase === 'final_winner_vote') return dropAllButTopOne(s), s;
      const next = nextPhase(s); startPhase(s,next,{forceNew:true});
    } else if (s.phase === 'cashout') {
      applyCashoutsAndContinue(s);
    } else if (s.phase === 'survival') {
      s.lastChallengePhase='survival'; startPhase(s,'audience_vote',{forceNew:true});
    } else if (['redflag','temptation','spill'].includes(s.phase)) {
      s.lastChallengePhase=s.phase; startPhase(s,'audience_vote',{forceNew:true});
    } else if (s.phase === 'chemistry') {
      startPhase(s,'temptation',{forceNew:true});
    } else if (s.phase === 'mingle') {
      startPhase(s,'survival',{forceNew:true});
    } else if (s.phase === 'couple_up') {
      if (s.matchReviewApproved && (s.couples||[]).some(c=>c.status==='active')) startPhase(s,'mingle',{forceNew:true});
    } else if (s.phase === 'finale_pitch') {
      startPhase(s,'final_winner_vote',{forceNew:true});
    } else if (s.phase === 'replacement') {
      startPhase(s,'first_impressions',{forceNew:true});
    } else {
      startPhase(s,nextPhase(s),{forceNew:true});
    }
  }
  return s;
}
async function mutateSession(idv, fn){
  const s = await getSessionById(idv);
  if (!s) return null;
  fn(s);
  await saveSession(s);
  return s;
}

app.get('/host', (req,res)=>res.sendFile(path.join(__dirname,'public','host.html')));
app.get('/public', (req,res)=>res.sendFile(path.join(__dirname,'public','public.html')));
app.get('/api/time', (req,res)=>res.json({ serverNow: nowIso(), defaultEventTimezone: DEFAULT_EVENT_TIMEZONE }));
app.post('/api/host/unlock', (req,res)=>res.json({ ok: req.body.pin === HOST_PIN }));
app.get('/api/sessions', async (req,res)=>{
  let sessions = await listSessions();
  for (const s of sessions) { autoTick(s); await saveSession(s); }
  sessions = await listSessions();
  let hostState = await getHostState();
  let active = await getSessionById(hostState.activeSessionId);
  if (!active || ['completed','ended','cleared'].includes(active.status)) { active = null; hostState.activeSessionId = null; await setHostState(hostState); }
  res.json({ storage: pool?'postgres':'memory', dbDiagnostic: dbDiagnostic(), serverNow:nowIso(), defaultEventTimezone: DEFAULT_EVENT_TIMEZONE, hostState, activeSession: active, sessions: sessions.map(publicSession) });
});
app.post('/api/host/create', async (req,res)=>{
  const s = createSession(req.body||{});
  await saveSession(s); await setHostState({ activeSessionId:s.id });
  res.json({ ok:true, session:s });
});
app.post('/api/host/select', async (req,res)=>{ const s=await getSessionById(req.body.sessionId); if(!s || ['completed','ended','cleared'].includes(s.status)) return res.status(404).json({error:'Session not available'}); await setHostState({activeSessionId:s.id}); res.json({ok:true,session:s}); });
app.post('/api/host/phase', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ if(req.body.phase==='start'){ ss.status='live'; ss.gameStartedAt=ss.gameStartedAt||nowIso(); startPhase(ss,'first_impressions',{forceNew:true,durationSec:120}); } else { if (['redflag','chemistry','spill','temptation','survival'].includes(req.body.phase)) ss.lastChallengePhase=req.body.phase; startPhase(ss,req.body.phase,{forceNew:true}); } }); res.json({ok:!!s,session:s}); });
app.post('/api/host/next', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ if(ss.phase==='couple_up' && !ss.matchReviewApproved) return; startPhase(ss,nextPhase(ss),{forceNew:true}); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/automation', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ if(req.body.mode) ss.automationMode=req.body.mode; if(req.body.pause!==undefined) ss.isPaused=!!req.body.pause; if(req.body.autoDump!==undefined) ss.autoDump=!!req.body.autoDump; }); res.json({ok:!!s,session:s}); });
app.post('/api/host/vote-timer', async (req,res)=>{ const sec = Number(req.body.seconds||120); const s=await mutateSession(req.body.sessionId, ss=>{ ss.phase = req.body.final ? 'final_winner_vote' : 'audience_vote'; ss.phaseInstanceId=id('phase'); ss.phaseStartedAt=nowIso(); ss.phaseEndsAt=new Date(Date.now()+sec*1000).toISOString(); ss.currentVoteKey=id('vote'); ss.voteLocked=false; }); res.json({ok:!!s,session:s}); });
app.post('/api/host/add-time', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const base = Math.max(Date.now(), new Date(ss.phaseEndsAt||nowIso()).getTime()); ss.phaseEndsAt = new Date(base + Number(req.body.seconds||30)*1000).toISOString(); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/lock-vote', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ ss.voteLocked=true; ss.resultsRevealed=true; }); res.json({ok:!!s,session:s}); });

app.post('/api/host/rebuild-matches', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ buildSuggestedMatches(ss); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/update-match', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ ss.suggestedMatches=ss.suggestedMatches||[]; const m=ss.suggestedMatches.find(x=>x.id===req.body.matchId); if(m){ if(Array.isArray(req.body.playerIds) && req.body.playerIds.length===2) m.playerIds=req.body.playerIds; if(req.body.coupleName!==undefined) m.coupleName=String(req.body.coupleName||'').slice(0,60); if(req.body.reason!==undefined) m.reason=String(req.body.reason||'').slice(0,160); if(req.body.approved!==undefined) m.approved=!!req.body.approved; } }); res.json({ok:!!s,session:s}); });
app.post('/api/host/approve-matches', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ if(Array.isArray(req.body.matches)){ ss.suggestedMatches=req.body.matches; } applyApprovedMatches(ss); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/settings', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ if(req.body.revealAnswerWriters!==undefined) ss.revealAnswerWriters=!!req.body.revealAnswerWriters; }); res.json({ok:!!s,session:s}); });

app.post('/api/host/iframe-url', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const u=String(req.body.voteIframeUrl||'').trim(); ss.voteIframeUrl = u; }); res.json({ok:!!s,session:s}); });
app.post('/api/host/drop-half', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ dropLowestHalf(ss); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/end-block', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ handleBlockEnd(ss); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/apply-cashout', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ applyCashoutsAndContinue(ss); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/clear-current', async (req,res)=>{ const hs=await getHostState(); const sid=req.body.sessionId || hs.activeSessionId; if(sid) await mutateSession(sid, ss=>{ ss.status='completed'; ss.phase='ended'; }); await setHostState({activeSessionId:null}); res.json({ok:true}); });
app.post('/api/host/delete-completed', async (req,res)=>{ const count=await deleteCompleted(); res.json({ok:true,count}); });
app.post('/api/host/delete-session', async (req,res)=>{ const ok=await deleteSessionById(req.body.sessionId); if(!ok) return res.status(404).json({error:'Session not found'}); res.json({ok:true}); });
app.post('/api/host/clear-stale', async (req,res)=>{ await setHostState({activeSessionId:null}); res.json({ok:true}); });
app.post('/api/host/kick-player', async (req,res)=>{
  const { sessionId, playerId } = req.body || {};
  const s = await mutateSession(sessionId, ss=>{
    const p = ss.players.find(x=>x.id===playerId);
    if (!p) return;
    p.status='kicked';
    p.kickedAt=nowIso();
    // Remove any active couple containing the kicked player from active play.
    (ss.couples||[]).forEach(c=>{
      if ((c.playerIds||[]).includes(playerId) && c.status==='active') {
        c.status='removed';
        c.removedAt=nowIso();
        c.removedReason='player_kicked';
      }
    });
    ss.votes=(ss.votes||[]).filter(v=>v.voterId!==playerId && v.targetPlayerId!==playerId);
    ss.answers=(ss.answers||[]).filter(a=>a.playerId!==playerId);
    ss.recouplingChoices=(ss.recouplingChoices||[]).filter(x=>x.playerId!==playerId);
    ss.finalePitches=(ss.finalePitches||[]).filter(x=>x.playerId!==playerId);
    ss.cashoutChoices=(ss.cashoutChoices||[]).filter(x=>x.playerId!==playerId);
    ss.reactions=(ss.reactions||[]).filter(x=>x.playerId!==playerId);
    ss.predictions=(ss.predictions||[]).filter(x=>x.playerId!==playerId);
  });
  res.json({ok:!!s,session:s});
});

app.post('/api/join/player', async (req,res)=>{
  const s = await getSessionByCode(req.body.code); if(!s) return res.status(404).json({error:'Session not found'});
  const profile = req.body.profile || {};
  const name = String(req.body.name || '').trim();
  let p = s.players.find(p=>p.id===req.body.playerId);
  const required = [
    ['Name / Nickname', name],
    ['My Type', profile.myType],
    ['Green Flag', profile.greenFlag],
    ['Red Flag', profile.redFlag],
    ['Best Pickup Line', profile.pickup]
  ];
  const missing = required.filter(([,v])=>!String(v||'').trim()).map(([k])=>k);
  const photoRequired = s.requirePlayerPhoto !== false;
  if (photoRequired && !req.body.photo && !p?.photo) missing.push('Profile Photo');
  if (missing.length) return res.status(400).json({error:'Complete all required profile fields: '+missing.join(', ')});
  if (!p) {
    p={ id:id('player'), name, photo:req.body.photo||'', profile, status:'active', joinedAt:nowIso() };
    s.players.push(p);
  } else {
    if (p.status === 'kicked') return res.status(403).json({error:'You have been removed from this session.'});
    p.name = name || p.name;
    // Preserve existing photo when a player edits profile without uploading a new one.
    p.photo = req.body.photo || p.photo || '';
    p.profile = { ...(p.profile||{}), ...profile };
    p.status = p.status || 'active';
  }
  await saveSession(s); res.json({ok:true,session:s,player:p});
});
app.post('/api/join/audience', async (req,res)=>{ const s=await getSessionByCode(req.body.code); if(!s) return res.status(404).json({error:'Session not found'}); let a=s.audience.find(a=>a.id===req.body.audienceId); const nickname=String(req.body.nickname||'').trim(); if(!a){ a={id:id('aud'),nickname:nickname||('Fan '+String((s.audience||[]).length+1)),points:0,joinedAt:nowIso()}; s.audience.push(a); } else { if(nickname) a.nickname=nickname; a.points=a.points||0; } await saveSession(s); res.json({ok:true,session:s,audience:a}); });
app.post('/api/auto-pair', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ autoPairByMutual(ss); }); res.json({ok:!!s,session:s}); });
app.post('/api/player/spark', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ ss.sparkVotes=ss.sparkVotes||[]; const key=[req.body.playerId,req.body.targetPlayerId,ss.phaseInstanceId].join(':'); ss.sparkVotes=ss.sparkVotes.filter(x=>x.key!==key); ss.sparkVotes.push({key,playerId:req.body.playerId,targetPlayerId:req.body.targetPlayerId,choice:req.body.choice,phase:ss.phase,phaseInstanceId:ss.phaseInstanceId,submittedAt:nowIso()}); }); res.json({ok:!!s,session:s}); });
app.post('/api/answer', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const key = `${req.body.playerId}:${ss.phaseInstanceId}:${ss.currentQuestionId}`; ss.answers = ss.answers.filter(a=>a.key!==key); ss.answers.push({ key, playerId:req.body.playerId, phase:ss.phase, phaseInstanceId:ss.phaseInstanceId, questionId:ss.currentQuestionId, value:req.body.value, text:req.body.text||'', submittedAt:nowIso() }); }); res.json({ok:!!s,session:s}); });
app.post('/api/finale-pitch', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const p=ss.players.find(p=>p.id===req.body.playerId); const couple=ss.couples.find(c=>c.status==='active' && c.playerIds.includes(req.body.playerId)); const key=`${couple?.id||req.body.playerId}:${ss.phaseInstanceId}`; ss.finalePitches=ss.finalePitches.filter(x=>x.key!==key); ss.finalePitches.push({key,coupleId:couple?.id,playerId:req.body.playerId,text:req.body.text||'',submittedAt:nowIso()}); if(p) p.latestFinalePitch=req.body.text||''; }); res.json({ok:!!s,session:s}); });
app.post('/api/recouple', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const key=`${req.body.playerId}:${ss.phaseInstanceId}`; ss.recouplingChoices=ss.recouplingChoices.filter(x=>x.key!==key); ss.recouplingChoices.push({key,playerId:req.body.playerId,phaseInstanceId:ss.phaseInstanceId,choice:req.body.choice,target:req.body.target||'',submittedAt:nowIso()}); }); res.json({ok:!!s,session:s}); });
app.post('/api/cashout', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const couple=ss.couples.find(c=>c.status==='active' && c.playerIds.includes(req.body.playerId)); if(!couple) return; const key=`${couple.id}:${req.body.playerId}:${ss.cashoutRoundId}`; ss.cashoutChoices=ss.cashoutChoices.filter(x=>x.key!==key); ss.cashoutChoices.push({key,coupleId:couple.id,playerId:req.body.playerId,cashoutRoundId:ss.cashoutRoundId,choice:req.body.choice,submittedAt:nowIso()}); if(req.body.choice==='cashout') couple.cashoutPending=true; }); res.json({ok:!!s,session:s}); });

app.post('/api/player/comfort', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ ss.comfortRequests=ss.comfortRequests||[]; const p=ss.players.find(x=>x.id===req.body.playerId); const type=String(req.body.type||'message_host'); const message=String(req.body.message||'').trim().slice(0,300); ss.comfortRequests.push({id:id('comfort'),playerId:req.body.playerId,playerName:p?.name||'',type,message,createdAt:nowIso(),resolved:false}); if(p && type==='remove_from_matching'){ p.matchEligible=false; p.comfortOptOutAt=nowIso(); } }); res.json({ok:!!s,session:s}); });
app.post('/api/player/continue-audience', async (req,res)=>{ let audience=null; const s=await mutateSession(req.body.sessionId, ss=>{ const p=ss.players.find(x=>x.id===req.body.playerId); if(p){ audience=ensureAudienceFromPlayer(ss,p,p.role||'Island Audience'); } }); res.json({ok:!!s,session:s,audience}); });

app.post('/api/audience/reaction', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ ss.reactions=ss.reactions||[]; const key=[req.body.audienceId,ss.phaseInstanceId,req.body.reaction,req.body.coupleId||'all'].join(':'); ss.reactions=ss.reactions.filter(x=>x.key!==key); ss.reactions.push({key,audienceId:req.body.audienceId,reaction:req.body.reaction,coupleId:req.body.coupleId||'',phase:ss.phase,phaseInstanceId:ss.phaseInstanceId,submittedAt:nowIso()}); }); res.json({ok:!!s,session:s}); });
app.post('/api/audience/prediction', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ ss.predictions=ss.predictions||[]; const key=[req.body.audienceId,ss.phaseInstanceId,req.body.type].join(':'); ss.predictions=ss.predictions.filter(x=>x.key!==key); ss.predictions.push({key,audienceId:req.body.audienceId,type:req.body.type,targetCoupleId:req.body.targetCoupleId||'',phase:ss.phase,phaseInstanceId:ss.phaseInstanceId,submittedAt:nowIso()}); }); res.json({ok:!!s,session:s}); });
app.post('/api/audience/question', async (req,res)=>{ const text=String(req.body.text||'').trim().slice(0,220); if(!text) return res.status(400).json({error:'Question is required'}); const s=await mutateSession(req.body.sessionId, ss=>{ ss.audienceQuestions=ss.audienceQuestions||[]; ss.audienceQuestions.push({id:id('aq'),audienceId:req.body.audienceId,text,approved:false,submittedAt:nowIso()}); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/approve-question', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const q=(ss.audienceQuestions||[]).find(x=>x.id===req.body.questionId); if(q){ q.approved=!!req.body.approved; q.approvedAt=nowIso(); } }); res.json({ok:!!s,session:s}); });

app.post('/api/vote', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ if(ss.voteLocked) return; const voteCategory=String(req.body.voteCategory||'main'); const voterKey=req.body.voterType+':'+req.body.voterId+':'+ss.currentVoteKey+':'+voteCategory; ss.votes=ss.votes.filter(v=>v.voterKey!==voterKey); ss.votes.push({voterKey,voteKey:ss.currentVoteKey,voteCategory,voterId:req.body.voterId,voterType:req.body.voterType,targetCoupleId:req.body.targetCoupleId||'',targetPlayerId:req.body.targetPlayerId||'',targetAnswerKey:req.body.targetAnswerKey||'',submittedAt:nowIso()}); }); res.json({ok:!!s,session:s}); });
app.get('/api/session/:code', async (req,res)=>{ const s=await getSessionByCode(req.params.code); if(!s || ['completed','ended','cleared'].includes(s.status)) return res.status(404).json({error:'This game session has ended or was cleared.'}); autoTick(s); await saveSession(s); res.json({session:s,serverNow:nowIso(), defaultEventTimezone: DEFAULT_EVENT_TIMEZONE}); });


app.get('/api/debug/database', async (req,res)=>{
  const diag = dbDiagnostic();
  res.json({
    ...diag,
    note: 'This endpoint does not expose passwords or secret values. It only confirms whether this running Render service can see database environment variables.'
  });
});

initDb().catch(e=>{ console.error('Postgres unavailable, using memory storage:', e.message); pool=null; }).finally(()=>{
  app.listen(PORT, '0.0.0.0', ()=>console.log(`Bar Island running on 0.0.0.0:${PORT}`));
});
