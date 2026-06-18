const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
const HOST_PIN = process.env.HOST_PIN || '1238';
const DATABASE_URL = process.env.DATABASE_URL;
let pool = null;
let memory = { sessions: {}, hostState: { activeSessionId: null } };

const QUESTION_POOL = [
  ...Array.from({ length: 20 }, (_, i) => ({ id: `rf${i+1}`, theme: 'redflag', type: 'choice', text: ['Who is more likely to ignore a red flag?','Who is more likely to flirt for free drinks?','Who is more likely to ghost after one date?','Who is more likely to start drama?'][i%4], options: ['me','partner','both','neither'] })),
  ...Array.from({ length: 20 }, (_, i) => ({ id: `chem${i+1}`, theme: 'chemistry', type: 'choice', text: ['Who plans the better date?','Who is more likely to text first?','Who would survive a couples trivia test?','Who is more likely to apologize first?'][i%4], options: ['me','partner','both','neither'] })),
  ...Array.from({ length: 20 }, (_, i) => ({ id: `tea${i+1}`, theme: 'spill', type: i%3===0?'typed':'choice', text: i%3===0?'Finish this sentence: Our couple would win Bar Island because...':['What would your partner do if their ex texted?','Who is more likely to cause a scene at brunch?','Who is the bigger flirt?'][i%3], options: ['ignore','reply','show_partner','say_who_dis'] })),
  ...Array.from({ length: 15 }, (_, i) => ({ id: `temp${i+1}`, theme: 'temptation', type: 'choice', text: ['Would you stay loyal if a bombshell chose you?','Who is more likely to switch teams?','Who is more tempted by attention?'][i%3], options: ['me','partner','both','neither'] })),
  ...Array.from({ length: 15 }, (_, i) => ({ id: `surv${i+1}`, theme: 'survival', type: i%4===0?'typed':'choice', text: i%4===0?'Give your couple a final campaign slogan.':['Who deserves to survive this island?','Who has the better crowd energy?','Who is carrying the couple?','Who is most likely to win?'][i%4], options: ['me','partner','both','neither'] })),
  ...Array.from({ length: 10 }, (_, i) => ({ id: `fin${i+1}`, theme: 'finale', type: 'typed', text: 'Why should the audience crown your couple Bar Island Champions?' }))
];

const PHASES = [
  'lobby','first_impressions','couple_up','mingle','redflag','audience_vote','chemistry','audience_vote','spill','audience_vote','temptation','audience_vote','recoupling','survival','audience_vote','finale_pitch','final_winner_vote','winner'
];
const PHASE_LABELS = {
  lobby:'Lobby', first_impressions:'First Impressions', couple_up:'Couple Up', mingle:'Mingle Time', redflag:'Red Flag / Green Flag', chemistry:'Chemistry Check', spill:'Spill the Tea', temptation:'Temptation / Switch-Up', recoupling:'Recoupling', survival:'Survival Challenge', audience_vote:'Audience Voting', finale_pitch:'Finale Pitch', final_winner_vote:'Final Winner Vote', winner:'Winner Reveal', cashout:'Cash Out or Double Down', replacement:'Replacement Teams'
};

function id(prefix='id'){ return prefix + '_' + crypto.randomBytes(6).toString('hex'); }
function code(){ return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function nowIso(){ return new Date().toISOString(); }
function msLeft(endsAt){ return endsAt ? Math.max(0, new Date(endsAt).getTime() - Date.now()) : 0; }
function durationFor(phase){
  if (phase === 'lobby') return 0;
  if (phase === 'mingle') return 5*60;
  if (phase === 'audience_vote') return 2*60;
  if (phase === 'final_winner_vote') return 5*60;
  if (phase === 'cashout') return 60;
  if (phase === 'recoupling') return 45;
  if (phase === 'finale_pitch') return 90;
  if (['redflag','chemistry','temptation','survival'].includes(phase)) return 30;
  if (phase === 'spill') return 60;
  return 60;
}
function publicSession(s){ return s; }

async function initDb(){
  if (!DATABASE_URL) return;
  pool = new Pool({ connectionString: DATABASE_URL, ssl: DATABASE_URL.includes('render.com') ? { rejectUnauthorized:false } : undefined });
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, code TEXT UNIQUE, status TEXT, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS host_state (id TEXT PRIMARY KEY, data JSONB NOT NULL, updated_at TIMESTAMPTZ DEFAULT NOW())`);
  await pool.query(`INSERT INTO host_state (id,data) VALUES ('main','{"activeSessionId":null}'::jsonb) ON CONFLICT (id) DO NOTHING`);
  console.log('Connected to PostgreSQL. Database tables ready.');
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

function pickQuestions(){
  const by = t => QUESTION_POOL.filter(q=>q.theme===t).sort(()=>Math.random()-.5).slice(0,4);
  return [...by('redflag'), ...by('chemistry'), ...by('spill'), ...by('temptation'), ...by('survival'), ...by('finale')];
}
function createSession(body){
  const startTime = body.startTime ? new Date(body.startTime).toISOString() : new Date(Date.now()+10*60000).toISOString();
  return {
    id:id('session'), code: code(), title: body.title || 'Bar Island', venue: body.venue || '', startTime,
    status:'upcoming', phase:'lobby', phaseIndex:0, phaseInstanceId:id('phase'), phaseStartedAt:null, phaseEndsAt:startTime,
    gameStartedAt:null, gameClockPausedMs:0, isPaused:false, automationMode: body.automationMode || 'manual', autoDump: !!body.autoDump,
    gameLengthHours: Number(body.gameLengthHours || 1), blockIndex:1, maxBlocks:Number(body.gameLengthHours || 1), maxCouples:6,
    players:[], audience:[], couples:[], votes:[], answers:[], recouplingChoices:[], finalePitches:[], cashoutChoices:[],
    questionSet: pickQuestions(), currentQuestionIndex:0, currentVoteKey:null, voteLocked:false, resultsRevealed:false,
    cashoutPrizes:{ block1: body.cashoutPrize1 || '', block2: body.cashoutPrize2 || '', final: body.finalPrize || '' }, finalPrizeRevealed:false,
    replacementOpen:false, replacementSlots:0, completedBlocks:[], winnerCoupleId:null,
    createdAt:nowIso(), updatedAt:nowIso()
  };
}
function phaseQuestion(s){
  const theme = s.phase === 'redflag' ? 'redflag' : s.phase === 'chemistry' ? 'chemistry' : s.phase === 'spill' ? 'spill' : s.phase === 'temptation' ? 'temptation' : s.phase === 'survival' ? 'survival' : s.phase === 'finale_pitch' ? 'finale' : null;
  if (!theme) return null;
  const qs = s.questionSet.filter(q=>q.theme===theme);
  return qs[(s.currentQuestionIndex||0) % Math.max(1,qs.length)] || null;
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
    if (phase === 'cashout') s.cashoutRoundId = id('cashout');
  }
  return s;
}
function nextPhase(s){
  const order = ['first_impressions','couple_up','mingle','redflag','audience_vote','chemistry','audience_vote','spill','audience_vote','temptation','audience_vote','recoupling','survival','audience_vote','finale_pitch','final_winner_vote','winner'];
  let i = order.indexOf(s.phase);
  if (i < 0) i = -1;
  let n = order[i+1] || 'winner';
  if (s.phase === 'audience_vote') {
    // after some vote windows, advance by current question progression
    const lastChallenge = s.lastChallengePhase || 'redflag';
    if (lastChallenge === 'redflag') n = 'chemistry';
    else if (lastChallenge === 'chemistry') n = 'spill';
    else if (lastChallenge === 'spill') n = 'temptation';
    else if (lastChallenge === 'temptation') n = 'recoupling';
    else if (lastChallenge === 'survival') n = shouldCashoutOrReplace(s) ? 'cashout' : 'finale_pitch';
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
    s.status='live'; s.gameStartedAt = s.gameStartedAt || nowIso(); startPhase(s, 'first_impressions', { forceNew:true, durationSec:120 });
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
    } else if (['redflag','chemistry','spill','temptation'].includes(s.phase)) {
      s.lastChallengePhase=s.phase; startPhase(s,'audience_vote',{forceNew:true});
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
app.get('/api/time', (req,res)=>res.json({ serverNow: nowIso() }));
app.post('/api/host/unlock', (req,res)=>res.json({ ok: req.body.pin === HOST_PIN }));
app.get('/api/sessions', async (req,res)=>{
  let sessions = await listSessions();
  for (const s of sessions) { autoTick(s); await saveSession(s); }
  sessions = await listSessions();
  let hostState = await getHostState();
  let active = await getSessionById(hostState.activeSessionId);
  if (!active || ['completed','ended','cleared'].includes(active.status)) { active = null; hostState.activeSessionId = null; await setHostState(hostState); }
  res.json({ storage: pool?'postgres':'memory', serverNow:nowIso(), hostState, activeSession: active, sessions: sessions.map(publicSession) });
});
app.post('/api/host/create', async (req,res)=>{
  const s = createSession(req.body||{});
  await saveSession(s); await setHostState({ activeSessionId:s.id });
  res.json({ ok:true, session:s });
});
app.post('/api/host/select', async (req,res)=>{ const s=await getSessionById(req.body.sessionId); if(!s || ['completed','ended','cleared'].includes(s.status)) return res.status(404).json({error:'Session not available'}); await setHostState({activeSessionId:s.id}); res.json({ok:true,session:s}); });
app.post('/api/host/phase', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ if(req.body.phase==='start'){ ss.status='live'; ss.gameStartedAt=ss.gameStartedAt||nowIso(); startPhase(ss,'first_impressions',{forceNew:true,durationSec:120}); } else { if (['redflag','chemistry','spill','temptation','survival'].includes(req.body.phase)) ss.lastChallengePhase=req.body.phase; startPhase(ss,req.body.phase,{forceNew:true}); } }); res.json({ok:!!s,session:s}); });
app.post('/api/host/next', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ startPhase(ss,nextPhase(ss),{forceNew:true}); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/automation', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ if(req.body.mode) ss.automationMode=req.body.mode; if(req.body.pause!==undefined) ss.isPaused=!!req.body.pause; if(req.body.autoDump!==undefined) ss.autoDump=!!req.body.autoDump; }); res.json({ok:!!s,session:s}); });
app.post('/api/host/vote-timer', async (req,res)=>{ const sec = Number(req.body.seconds||120); const s=await mutateSession(req.body.sessionId, ss=>{ ss.phase = req.body.final ? 'final_winner_vote' : 'audience_vote'; ss.phaseInstanceId=id('phase'); ss.phaseStartedAt=nowIso(); ss.phaseEndsAt=new Date(Date.now()+sec*1000).toISOString(); ss.currentVoteKey=id('vote'); ss.voteLocked=false; }); res.json({ok:!!s,session:s}); });
app.post('/api/host/add-time', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const base = Math.max(Date.now(), new Date(ss.phaseEndsAt||nowIso()).getTime()); ss.phaseEndsAt = new Date(base + Number(req.body.seconds||30)*1000).toISOString(); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/lock-vote', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ ss.voteLocked=true; ss.resultsRevealed=true; }); res.json({ok:!!s,session:s}); });
app.post('/api/host/drop-half', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ dropLowestHalf(ss); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/end-block', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ handleBlockEnd(ss); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/apply-cashout', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ applyCashoutsAndContinue(ss); }); res.json({ok:!!s,session:s}); });
app.post('/api/host/clear-current', async (req,res)=>{ const hs=await getHostState(); const sid=req.body.sessionId || hs.activeSessionId; if(sid) await mutateSession(sid, ss=>{ ss.status='completed'; ss.phase='ended'; }); await setHostState({activeSessionId:null}); res.json({ok:true}); });
app.post('/api/host/delete-completed', async (req,res)=>{ const count=await deleteCompleted(); res.json({ok:true,count}); });
app.post('/api/host/clear-stale', async (req,res)=>{ await setHostState({activeSessionId:null}); res.json({ok:true}); });

app.post('/api/join/player', async (req,res)=>{
  const s = await getSessionByCode(req.body.code); if(!s) return res.status(404).json({error:'Session not found'});
  let p = s.players.find(p=>p.id===req.body.playerId);
  if (!p) { p={ id:id('player'), name:req.body.name||'Islander', photo:req.body.photo||'', profile:req.body.profile||{}, status:'active', joinedAt:nowIso() }; s.players.push(p); }
  else { p.name=req.body.name||p.name; p.photo=req.body.photo||p.photo; p.profile=req.body.profile||p.profile; }
  await saveSession(s); res.json({ok:true,session:s,player:p});
});
app.post('/api/join/audience', async (req,res)=>{ const s=await getSessionByCode(req.body.code); if(!s) return res.status(404).json({error:'Session not found'}); let a=s.audience.find(a=>a.id===req.body.audienceId); if(!a){ a={id:id('aud'),joinedAt:nowIso()}; s.audience.push(a); await saveSession(s);} res.json({ok:true,session:s,audience:a}); });
app.post('/api/auto-pair', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const singles=ss.players.filter(p=>p.status==='active' && !ss.couples.some(c=>c.status==='active' && c.playerIds.includes(p.id))); for(let i=0;i<singles.length-1 && ss.couples.filter(c=>c.status==='active').length<ss.maxCouples;i+=2){ ss.couples.push({ id:id('couple'), playerIds:[singles[i].id,singles[i+1].id], status:'active', points:0, createdAt:nowIso() }); } }); res.json({ok:!!s,session:s}); });
app.post('/api/answer', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const key = `${req.body.playerId}:${ss.phaseInstanceId}:${ss.currentQuestionId}`; ss.answers = ss.answers.filter(a=>a.key!==key); ss.answers.push({ key, playerId:req.body.playerId, phase:ss.phase, phaseInstanceId:ss.phaseInstanceId, questionId:ss.currentQuestionId, value:req.body.value, text:req.body.text||'', submittedAt:nowIso() }); }); res.json({ok:!!s,session:s}); });
app.post('/api/finale-pitch', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const p=ss.players.find(p=>p.id===req.body.playerId); const couple=ss.couples.find(c=>c.status==='active' && c.playerIds.includes(req.body.playerId)); const key=`${couple?.id||req.body.playerId}:${ss.phaseInstanceId}`; ss.finalePitches=ss.finalePitches.filter(x=>x.key!==key); ss.finalePitches.push({key,coupleId:couple?.id,playerId:req.body.playerId,text:req.body.text||'',submittedAt:nowIso()}); if(p) p.latestFinalePitch=req.body.text||''; }); res.json({ok:!!s,session:s}); });
app.post('/api/recouple', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const key=`${req.body.playerId}:${ss.phaseInstanceId}`; ss.recouplingChoices=ss.recouplingChoices.filter(x=>x.key!==key); ss.recouplingChoices.push({key,playerId:req.body.playerId,phaseInstanceId:ss.phaseInstanceId,choice:req.body.choice,target:req.body.target||'',submittedAt:nowIso()}); }); res.json({ok:!!s,session:s}); });
app.post('/api/cashout', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ const couple=ss.couples.find(c=>c.status==='active' && c.playerIds.includes(req.body.playerId)); if(!couple) return; const key=`${couple.id}:${req.body.playerId}:${ss.cashoutRoundId}`; ss.cashoutChoices=ss.cashoutChoices.filter(x=>x.key!==key); ss.cashoutChoices.push({key,coupleId:couple.id,playerId:req.body.playerId,cashoutRoundId:ss.cashoutRoundId,choice:req.body.choice,submittedAt:nowIso()}); if(req.body.choice==='cashout') couple.cashoutPending=true; }); res.json({ok:!!s,session:s}); });
app.post('/api/vote', async (req,res)=>{ const s=await mutateSession(req.body.sessionId, ss=>{ if(ss.voteLocked) return; const voterKey=req.body.voterType+':'+req.body.voterId+':'+ss.currentVoteKey; ss.votes=ss.votes.filter(v=>v.voterKey!==voterKey); ss.votes.push({voterKey,voteKey:ss.currentVoteKey,voterId:req.body.voterId,voterType:req.body.voterType,targetCoupleId:req.body.targetCoupleId,submittedAt:nowIso()}); }); res.json({ok:!!s,session:s}); });
app.get('/api/session/:code', async (req,res)=>{ const s=await getSessionByCode(req.params.code); if(!s || ['completed','ended','cleared'].includes(s.status)) return res.status(404).json({error:'This game session has ended or was cleared.'}); autoTick(s); await saveSession(s); res.json({session:s,serverNow:nowIso()}); });

initDb().catch(e=>{ console.error('Postgres unavailable, using memory storage:', e.message); pool=null; }).finally(()=>{
  app.listen(PORT, '0.0.0.0', ()=>console.log(`Bar Island running on 0.0.0.0:${PORT}`));
});
