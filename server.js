const express = require('express');
const path = require('path');
const crypto = require('crypto');
const QRCode = require('qrcode');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST_PIN = process.env.HOST_PIN || '1238';
const DATABASE_URL = process.env.DATABASE_URL;

app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function id(prefix='id'){ return `${prefix}_${crypto.randomBytes(5).toString('hex')}`; }
function code(){ return crypto.randomBytes(3).toString('hex').toUpperCase(); }
function clean(s=''){ return String(s ?? '').replace(/[<>]/g,'').trim().slice(0,700); }
function cleanPhoto(data=''){ const v=String(data||''); if(!/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(v)) return ''; return v.length <= 900000 ? v : ''; }
function nowIso(){ return new Date().toISOString(); }
function addSeconds(sec){ return new Date(Date.now() + sec * 1000).toISOString(); }
function hostOnly(req,res,next){ const pin=String(req.headers['x-host-pin'] || req.body?.hostPin || ''); if(pin!==HOST_PIN) return res.status(401).json({error:'Host PIN required.'}); next(); }

const usePostgres = Boolean(DATABASE_URL);
let pool=null;
let memoryDb={ sessions:{}, host_state:{} };
const MINGLE_SECONDS = Number(process.env.MINGLE_SECONDS || 300);
const RECOUPLING_SECONDS = Number(process.env.RECOUPLING_SECONDS || 45);
const VOTE_SECONDS = Number(process.env.VOTE_SECONDS || 300);
const WINNER_VOTE_SECONDS = Number(process.env.WINNER_VOTE_SECONDS || 75);
const AUTO_REVEAL_SECONDS = Number(process.env.AUTO_REVEAL_SECONDS || 20);
const AUTO_TIMERS = { firstImpressions:120, firstCoupling:60, reveal:20, cashout:60 };
const CONVERSATION_STARTERS = [
  'What is your biggest green flag?',
  'What is your funniest red flag?',
  'What would make us win Bar Island?',
  'What is your ideal first date?',
  'What should our couple strategy be?',
  'What is your best closing-time food order?'
];
if(usePostgres){
  const needsSsl = process.env.PGSSLMODE === 'require' || /render\.com|amazonaws\.com|railway|supabase/i.test(DATABASE_URL);
  pool = new Pool({ connectionString:DATABASE_URL, ssl: needsSsl ? {rejectUnauthorized:false} : undefined, max:10, idleTimeoutMillis:30000, connectionTimeoutMillis:10000 });
}

// 100 reusable Bar Island prompts. The app locks a fresh session question set so refreshes never reshuffle.
const QUESTION_POOL = [
  {id:'C001',cat:'compatibility',type:'choice',seconds:30,text:'Who in your couple is more likely to start drama?',options:['Me','My Partner','Both','Neither']},
  {id:'C002',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to flirt for free drinks?',options:['Me','My Partner','Both','Neither']},
  {id:'C003',cat:'compatibility',type:'choice',seconds:30,text:'Who would be the first to text back after the date?',options:['Me','My Partner','Both','Neither']},
  {id:'C004',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to plan the perfect date?',options:['Me','My Partner','Both','Neither']},
  {id:'C005',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to show up late but look amazing?',options:['Me','My Partner','Both','Neither']},
  {id:'C006',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to become best friends with the bartender?',options:['Me','My Partner','Both','Neither']},
  {id:'C007',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to order appetizers for the table?',options:['Me','My Partner','Both','Neither']},
  {id:'C008',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to post the couple selfie first?',options:['Me','My Partner','Both','Neither']},
  {id:'C009',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to remember the anniversary?',options:['Me','My Partner','Both','Neither']},
  {id:'C010',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to become jealous over nothing?',options:['Me','My Partner','Both','Neither']},
  {id:'C011',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to pick the music in the car?',options:['Me','My Partner','Both','Neither']},
  {id:'C012',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to make the first move?',options:['Me','My Partner','Both','Neither']},
  {id:'C013',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to accidentally leave someone on read?',options:['Me','My Partner','Both','Neither']},
  {id:'C014',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to turn a small disagreement into a full episode?',options:['Me','My Partner','Both','Neither']},
  {id:'C015',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to win over the other person’s friends?',options:['Me','My Partner','Both','Neither']},
  {id:'C016',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to secretly love attention?',options:['Me','My Partner','Both','Neither']},
  {id:'C017',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to apologize first?',options:['Me','My Partner','Both','Neither']},
  {id:'C018',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to start dancing before anyone else?',options:['Me','My Partner','Both','Neither']},
  {id:'C019',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to give the better pep talk?',options:['Me','My Partner','Both','Neither']},
  {id:'C020',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to overthink a simple text?',options:['Me','My Partner','Both','Neither']},
  {id:'C021',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to keep the relationship fun?',options:['Me','My Partner','Both','Neither']},
  {id:'C022',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to make brunch plans?',options:['Me','My Partner','Both','Neither']},
  {id:'C023',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to be the problem and the solution?',options:['Me','My Partner','Both','Neither']},
  {id:'C024',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to remember everyone’s drink order?',options:['Me','My Partner','Both','Neither']},
  {id:'C025',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to be calm during chaos?',options:['Me','My Partner','Both','Neither']},
  {id:'C026',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to be the life of the party?',options:['Me','My Partner','Both','Neither']},
  {id:'C027',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to need reassurance?',options:['Me','My Partner','Both','Neither']},
  {id:'C028',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to start a group chat about the date?',options:['Me','My Partner','Both','Neither']},
  {id:'C029',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to make the better first impression?',options:['Me','My Partner','Both','Neither']},
  {id:'C030',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to say “I know a place” and actually know a place?',options:['Me','My Partner','Both','Neither']},
  {id:'C031',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to be secretly competitive?',options:['Me','My Partner','Both','Neither']},
  {id:'C032',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to charm the room?',options:['Me','My Partner','Both','Neither']},
  {id:'C033',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to turn a date into an adventure?',options:['Me','My Partner','Both','Neither']},
  {id:'C034',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to need a snack immediately?',options:['Me','My Partner','Both','Neither']},
  {id:'C035',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to have the stronger red flag?',options:['Me','My Partner','Both','Neither']},
  {id:'C036',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to be loyal after one good conversation?',options:['Me','My Partner','Both','Neither']},
  {id:'C037',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to make the other laugh hardest?',options:['Me','My Partner','Both','Neither']},
  {id:'C038',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to be the better wingperson?',options:['Me','My Partner','Both','Neither']},
  {id:'C039',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to win the crowd over?',options:['Me','My Partner','Both','Neither']},
  {id:'C040',cat:'compatibility',type:'choice',seconds:30,text:'Who is more likely to survive Bar Island without recoupling?',options:['Me','My Partner','Both','Neither']},
  {id:'S041',cat:'spill',type:'choice',seconds:30,text:'Your partner gets a text from an ex. What do they do?',options:['Ignore it','Reply secretly','Show me immediately','Say “who is this?”']},
  {id:'S042',cat:'spill',type:'choice',seconds:30,text:'Your couple gets one free vacation. What is the vibe?',options:['Luxury resort','Wild party trip','Food tour','Staycation with room service']},
  {id:'S043',cat:'spill',type:'choice',seconds:30,text:'The bill comes. What happens?',options:['Split it','One person grabs it','Argue playfully','Pretend the card declined']},
  {id:'S044',cat:'spill',type:'choice',seconds:30,text:'A stranger compliments your partner. What is your move?',options:['Smile proudly','Compliment them too','Step closer','Ask if they vote audience']},
  {id:'S045',cat:'spill',type:'choice',seconds:30,text:'Your couple has a theme song. What genre is it?',options:['R&B slow jam','Country heartbreak','Pop anthem','Bounce/club song']},
  {id:'S046',cat:'spill',type:'choice',seconds:30,text:'Your partner is hangry. What do you do first?',options:['Order fries','Offer my drink','Stay quiet','Start negotiating']},
  {id:'S047',cat:'spill',type:'choice',seconds:30,text:'The couple beside you is stronger. What is your strategy?',options:['Be funnier','Be cuter','Start drama','Trust our connection']},
  {id:'S048',cat:'spill',type:'choice',seconds:30,text:'Someone tries to steal your partner. What do you do?',options:['Make a speech','Let them try','Steal back harder','Immediately recouple']},
  {id:'S049',cat:'spill',type:'choice',seconds:30,text:'Your partner forgot your name. What is the proper punishment?',options:['No points','Buy me a drink','Public apology','Immediate dumping']},
  {id:'S050',cat:'spill',type:'choice',seconds:30,text:'Pick your couple’s toxic trait.',options:['Too competitive','Too flirty','Too dramatic','Too cute to trust']},
  {id:'S051',cat:'spill',type:'choice',seconds:30,text:'Pick your couple’s green flag.',options:['Funny together','Honest energy','Great teamwork','Crowd favorite']},
  {id:'S052',cat:'spill',type:'choice',seconds:30,text:'Your couple has to host karaoke. What song type wins?',options:['Power ballad','Throwback duet','Rap verse','Something ridiculous']},
  {id:'S053',cat:'spill',type:'choice',seconds:30,text:'Your partner disappears for 10 minutes. Where are they?',options:['At the bar','Taking selfies','Making friends','Avoiding drama']},
  {id:'S054',cat:'spill',type:'choice',seconds:30,text:'What would break your couple first?',options:['Bad communication','Bad dancing','Different food taste','A bombshell']},
  {id:'S055',cat:'spill',type:'choice',seconds:30,text:'What is your couple’s bar order energy?',options:['Classic cocktail','Shots','Mocktail and chill','Whatever is cheapest']},
  {id:'S056',cat:'spill',type:'choice',seconds:30,text:'The audience boos your answer. What do you do?',options:['Double down','Blame partner','Win them back','Laugh it off']},
  {id:'S057',cat:'spill',type:'choice',seconds:30,text:'Your couple has one superpower tonight. Choose it.',options:['Read minds','Steal votes','Freeze drama','Instant charm']},
  {id:'S058',cat:'spill',type:'choice',seconds:30,text:'What is your couple most likely to argue about?',options:['Where to eat','Who is funnier','Texting habits','Nothing, we are perfect']},
  {id:'S059',cat:'spill',type:'choice',seconds:30,text:'What would your couple bring to the island?',options:['A speaker','Snacks','Sunscreen','A backup option']},
  {id:'S060',cat:'spill',type:'choice',seconds:30,text:'What is the first date dealbreaker?',options:['Rude to staff','Talks about ex','Bad tipper','No sense of humor']},
  {id:'S061',cat:'spill',type:'choice',seconds:30,text:'Pick your couple’s closing-time energy.',options:['Going home early','After party','Food run','Still arguing outside']},
  {id:'S062',cat:'spill',type:'choice',seconds:30,text:'What is your couple’s biggest threat?',options:['A new bombshell','Audience vote','Too much confidence','No strategy']},
  {id:'S063',cat:'spill',type:'choice',seconds:30,text:'Your partner says “we need to talk.” What is it about?',options:['The vote','The vibes','The bill','The other couple']},
  {id:'S064',cat:'spill',type:'choice',seconds:30,text:'What is your couple’s secret weapon?',options:['Chemistry','Comedy','Chaos','Crowd work']},
  {id:'S065',cat:'spill',type:'choice',seconds:30,text:'Pick the couple nickname vibe.',options:['Cute','Messy','Power couple','Unhinged but lovable']},
  {id:'R066',cat:'redflag',type:'choice',seconds:30,text:'Which red flag is easiest to forgive?',options:['Bad texter','Too flirty','Always late','Too dramatic']},
  {id:'R067',cat:'redflag',type:'choice',seconds:30,text:'Which green flag wins Bar Island?',options:['Great listener','Funny under pressure','Loyal energy','Buys appetizers']},
  {id:'R068',cat:'redflag',type:'choice',seconds:30,text:'What is the most suspicious dating app bio line?',options:['Just ask','No drama','Entrepreneur','Here for a good time']},
  {id:'R069',cat:'redflag',type:'choice',seconds:30,text:'What is the biggest bar-date mistake?',options:['On phone','Rude to bartender','Too many ex stories','No questions back']},
  {id:'R070',cat:'redflag',type:'choice',seconds:30,text:'Which phrase is the biggest warning sign?',options:['I hate labels','My ex was crazy','I never apologize','Trust me']},
  {id:'R071',cat:'redflag',type:'choice',seconds:30,text:'Who should the audience trust least tonight?',options:['The smooth talker','The quiet one','The dramatic one','The one with options']},
  {id:'R072',cat:'redflag',type:'choice',seconds:30,text:'Which move is most likely to get someone dumped?',options:['Voting wrong','Ignoring partner','Flirting too hard','Being boring']},
  {id:'R073',cat:'redflag',type:'choice',seconds:30,text:'Pick the most dangerous compliment.',options:['You are trouble','You look expensive','You seem loyal','You remind me of my ex']},
  {id:'R074',cat:'redflag',type:'choice',seconds:30,text:'What is the best apology after bar-game drama?',options:['I was wrong','I panicked','The audience made me','I choose you now']},
  {id:'R075',cat:'redflag',type:'choice',seconds:30,text:'What is the strongest couple test?',options:['Jealousy','Comedy','Teamwork','Public voting']},
  {id:'R076',cat:'redflag',type:'choice',seconds:30,text:'Which habit is secretly cute?',options:['Over-explaining','Taking too many pictures','Ordering too much food','Laughing at own jokes']},
  {id:'R077',cat:'redflag',type:'choice',seconds:30,text:'Which would ruin a second date fastest?',options:['Bad manners','Bad jokes','Bad planning','Bad playlist']},
  {id:'R078',cat:'redflag',type:'choice',seconds:30,text:'What is the ultimate Bar Island survival skill?',options:['Flirting','Honesty','Strategy','Being funny']},
  {id:'R079',cat:'redflag',type:'choice',seconds:30,text:'Which couple is hardest to beat?',options:['The funny couple','The hot couple','The loyal couple','The chaotic couple']},
  {id:'R080',cat:'redflag',type:'choice',seconds:30,text:'What gets the crowd on your side fastest?',options:['A great answer','A bold move','A sweet moment','A little drama']},
  {id:'A081',cat:'audience',type:'typed',seconds:60,text:'Create your couple’s official nickname.'},
  {id:'A082',cat:'audience',type:'typed',seconds:60,text:'Write your couple’s best pickup line to the audience.'},
  {id:'A083',cat:'audience',type:'typed',seconds:60,text:'Give your couple a slogan in seven words or fewer.'},
  {id:'A084',cat:'audience',type:'typed',seconds:60,text:'Confess your couple’s fake scandal in one sentence.'},
  {id:'A085',cat:'audience',type:'typed',seconds:60,text:'Write a dramatic recoupling speech in one sentence.'},
  {id:'A086',cat:'audience',type:'typed',seconds:60,text:'Tell the audience why your couple is not a red flag.'},
  {id:'A087',cat:'audience',type:'typed',seconds:60,text:'Invent your couple’s first-date headline.'},
  {id:'A088',cat:'audience',type:'typed',seconds:60,text:'What is your couple’s funniest shared weakness?'},
  {id:'A089',cat:'audience',type:'typed',seconds:60,text:'Pitch your couple as a reality show in one sentence.'},
  {id:'A090',cat:'audience',type:'typed',seconds:60,text:'What would your couple’s friends warn us about?'},
  {id:'F091',cat:'finale',type:'typed',seconds:90,text:'Why should the audience crown you Bar Island Champions?'},
  {id:'F092',cat:'finale',type:'typed',seconds:90,text:'Make your final pitch to the crowd in one sentence.'},
  {id:'F093',cat:'finale',type:'typed',seconds:90,text:'What makes your connection stronger than the other couples?'},
  {id:'F094',cat:'finale',type:'typed',seconds:90,text:'Describe your couple in three words, then defend it.'},
  {id:'F095',cat:'finale',type:'typed',seconds:90,text:'What promise does your couple make to the audience?'},
  {id:'F096',cat:'finale',type:'typed',seconds:90,text:'If your couple wins, what is your victory speech?'},
  {id:'F097',cat:'finale',type:'typed',seconds:90,text:'What is the biggest reason your couple survived Bar Island?'},
  {id:'F098',cat:'finale',type:'typed',seconds:90,text:'What would your couple’s theme song be and why?'},
  {id:'F099',cat:'finale',type:'typed',seconds:90,text:'Tell the audience the moment your couple became champions.'},
  {id:'F100',cat:'finale',type:'typed',seconds:90,text:'Give the crowd one reason to vote for you right now.'}
];
const QUESTION_PHASES = ['redFlag','chemistry','spillTea','temptation','survival','finale'];
const PHASE_CATS = {
  redFlag:['redflag'],
  chemistry:['compatibility'],
  spillTea:['spill','audience'],
  temptation:['redflag','spill','compatibility'],
  survival:['compatibility','redflag','spill','audience'],
  finale:['finale']
};
const PHASE_FALLBACK = { redFlag:'R066', chemistry:'C001', spillTea:'S041', temptation:'S047', survival:'C001', finale:'F091' };
function hashNum(input){ return crypto.createHash('sha256').update(String(input)).digest().readUInt32BE(0); }
function shuffled(arr, seed){ return [...arr].sort((a,b)=>hashNum(`${seed}:${a.id}`)-hashNum(`${seed}:${b.id}`)); }
function createQuestionSet(session, mode='fresh'){
  const seed = `${session.calendarDate || session.scheduledAt || session.createdAt}:${session.code}:${session.id}`;
  const used = new Set();
  const set=[];
  for(const phase of QUESTION_PHASES){
    const cats = PHASE_CATS[phase] || [];
    const candidates = shuffled(QUESTION_POOL.filter(q=>cats.includes(q.cat) && !used.has(q.id)), `${seed}:${phase}`);
    const chosen = candidates[0] || QUESTION_POOL.find(q=>q.id===PHASE_FALLBACK[phase]);
    if(chosen){ used.add(chosen.id); set.push({...chosen, phase}); }
  }
  // Add survival questions for Rolling Island Mode. These are used after replacement couples enter.
  const survival = shuffled(QUESTION_POOL.filter(q=>!used.has(q.id)), `${seed}:survival`).slice(0,18).map((q,i)=>({...q, phase:'survival', survivalIndex:i}));
  return [...set, ...survival];
}
function questionForPhase(session, phase=session.phase){
  if(phase==='survival'){
    const qs=(session.questionSet || []).filter(q=>q.phase==='survival');
    if(qs.length) return qs[Math.max(0, Number(session.survivalQuestionPointer || 0)) % qs.length];
  }
  return (session.questionSet || []).find(q=>q.phase===phase) || null;
}
function isQuestionPhase(phase){ return QUESTION_PHASES.includes(phase); }
function startQuestionTimer(session, phase=session.phase, force=false){
  if(!isQuestionPhase(phase)) return;
  const q = questionForPhase(session, phase);
  if(!q) return;
  if(!force && session.currentQuestionId === q.id && session.questionEndsAt) return;
  session.currentQuestionId = q.id;
  session.currentQuestionIndex = Math.max(0, (session.questionSet || []).findIndex(x=>x.id===q.id));
  session.questionStartedAt = nowIso();
  session.questionEndsAt = addSeconds(Number(q.seconds || 30));
  session.questionLocked = false;
  session.hostShowAnswers = false;
}
function startMingleTimer(session, force=false){
  if(!force && session.mingleEndsAt) return;
  session.mingleStartedAt = nowIso();
  session.mingleEndsAt = addSeconds(MINGLE_SECONDS);
}
function addMingleMinute(session){
  const base = session.mingleEndsAt && Date.parse(session.mingleEndsAt) > Date.now() ? Date.parse(session.mingleEndsAt) : Date.now();
  session.mingleEndsAt = new Date(base + 60000).toISOString();
  if(!session.mingleStartedAt) session.mingleStartedAt = nowIso();
}
function getMingle(session){
  if(session.phase !== 'mingle') return null;
  if(!session.mingleEndsAt) startMingleTimer(session, true);
  return { startedAt: session.mingleStartedAt || '', endsAt: session.mingleEndsAt || '', seconds: MINGLE_SECONDS, starters: CONVERSATION_STARTERS };
}
function getCurrentQuestion(session){
  const q = questionForPhase(session, session.phase);
  if(!q) return null;
  const ends = session.currentQuestionId===q.id ? session.questionEndsAt : '';
  const expired = ends ? Date.parse(ends) <= Date.now() : false;
  if(expired) session.questionLocked = true;
  return {...q, startedAt: session.questionStartedAt || '', endsAt: ends, locked: Boolean(session.questionLocked || expired), showAnswers:Boolean(session.hostShowAnswers)};
}
function normalizeAnswerForCouple(answer, playerId, couple){
  if(!answer) return '';
  const txt = String(answer).toLowerCase();
  if(['both','neither'].includes(txt)) return txt;
  if(!couple || couple.players.length < 2) return txt;
  const [a,b]=couple.players;
  if(txt === 'me') return playerId === a ? a : b;
  if(txt === 'my partner' || txt === 'partner') return playerId === a ? b : a;
  return txt;
}
function getAnswerRows(session, reveal=false){
  const q = getCurrentQuestion(session);
  const answers = Object.values(session.challengeAnswers || {}).filter(a => !q || a.questionId === q.id || a.phase === session.phase);
  if(!reveal && !session.hostShowAnswers) return [];
  return answers.map(a=>({
    ...a,
    playerName: session.players[a.playerId]?.name || 'Player',
    coupleName: coupleName(session, a.coupleId),
    option: a.option || '',
    text: a.text || a.option || ''
  }));
}
function getProgress(session){
  const q = getCurrentQuestion(session);
  const activePlayers = Object.values(session.players || {}).filter(p=>!['dumped','cashedOut'].includes(p.status) && p.coupleId);
  const keys = new Set(Object.values(session.challengeAnswers || {}).filter(a=>q && a.questionId===q.id).map(a=>a.playerId));
  const couples = session.couples || [];
  let completeCouples=0;
  const coupleResults = couples.map(c=>{
    const players = c.players.map(pid=>session.players[pid]).filter(Boolean).filter(p=>!['dumped','cashedOut'].includes(p.status));
    const answered = players.filter(p=>keys.has(p.id));
    if(players.length && answered.length===players.length) completeCouples++;
    let match = null;
    if(q && q.type==='choice' && players.length>=2 && answered.length>=2){
      const av = players.map(p=>Object.values(session.challengeAnswers).find(a=>a.questionId===q.id && a.playerId===p.id));
      const norm = av.map((a,i)=>normalizeAnswerForCouple(a?.option || a?.text, players[i].id, c));
      match = norm[0] && norm[0] === norm[1];
    }
    return {coupleId:c.id,coupleName:coupleName(session,c.id),players:players.length,answered:answered.length,complete:players.length>0 && answered.length===players.length,match};
  });
  return { questionId:q?.id || '', totalPlayers:activePlayers.length, answeredPlayers:keys.size, totalCouples:couples.length, completeCouples, coupleResults };
}

async function initStorage(){
  if(!usePostgres){ console.log('DATABASE_URL not set. Using temporary in-memory storage.'); return; }
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
    CREATE TABLE IF NOT EXISTS recoupling_choices (
      session_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      recoupling_started_at TEXT NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (session_id, player_id, recoupling_started_at)
    );
    CREATE INDEX IF NOT EXISTS idx_recoupling_choices_session ON recoupling_choices (session_id, recoupling_started_at);
    CREATE TABLE IF NOT EXISTS finale_pitches (
      session_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      data JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (session_id, player_id, question_id)
    );
    CREATE INDEX IF NOT EXISTS idx_finale_pitches_session ON finale_pitches (session_id, question_id);
  `);
  const check = await pool.query('SELECT current_database() AS database, current_user AS user');
  console.log(`Connected to PostgreSQL. Database tables ready. DB=${check.rows[0].database} USER=${check.rows[0].user}`);
}
async function hydrateRecouplingChoices(session){
  if(!session) return session;
  session.recouplingRequests=session.recouplingRequests||{};
  if(!usePostgres || !session.id || !session.recouplingStartedAt) return session;
  try{
    const r=await pool.query('SELECT player_id, data FROM recoupling_choices WHERE session_id=$1 AND recoupling_started_at=$2',[session.id, session.recouplingStartedAt]);
    for(const row of r.rows){ session.recouplingRequests[row.player_id]=row.data; }
  }catch(err){ console.error('Failed to hydrate recoupling choices:',err.message); }
  return session;
}
async function saveRecouplingChoiceRow(session, playerId, choiceData){
  if(!session || !playerId || !choiceData || !usePostgres) return;
  const startedAt=session.recouplingStartedAt || 'active';
  await pool.query(`INSERT INTO recoupling_choices (session_id, player_id, recoupling_started_at, data, updated_at)
    VALUES ($1,$2,$3,$4::jsonb,NOW())
    ON CONFLICT (session_id, player_id, recoupling_started_at)
    DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`,[session.id, playerId, startedAt, JSON.stringify(choiceData)]);
}

async function hydrateFinalePitches(session){
  if(!session) return session;
  session.finalePitches=session.finalePitches||{};
  if(!usePostgres || !session.id) return session;
  try{
    const r=await pool.query('SELECT player_id, question_id, data FROM finale_pitches WHERE session_id=$1',[session.id]);
    for(const row of r.rows){
      const data=row.data||{};
      const key=data.key || `${row.question_id}_${row.player_id}`;
      session.finalePitches[key]=data;
      if(session.players?.[row.player_id]) session.players[row.player_id].lastFinalePitch=data;
    }
  }catch(err){ console.error('Failed to hydrate finale pitches:',err.message); }
  return session;
}
async function hydrateSessionExtras(session){
  if(!session) return session;
  await hydrateRecouplingChoices(session);
  await hydrateFinalePitches(session);
  return session;
}
async function saveFinalePitchRow(session, playerId, pitchData){
  if(!session || !playerId || !pitchData || !usePostgres) return;
  const questionId=pitchData.questionId || session.currentQuestionId || 'finale';
  await pool.query(`INSERT INTO finale_pitches (session_id, player_id, question_id, data, updated_at)
    VALUES ($1,$2,$3,$4::jsonb,NOW())
    ON CONFLICT (session_id, player_id, question_id)
    DO UPDATE SET data=EXCLUDED.data, updated_at=NOW()`,[session.id, playerId, questionId, JSON.stringify(pitchData)]);
}
async function loadDb(){ if(!usePostgres) return memoryDb; const r=await pool.query('SELECT data FROM sessions ORDER BY COALESCE(scheduled_at, created_at) ASC, created_at ASC'); const sessions={}; for(const row of r.rows){ const hydrated=await hydrateSessionExtras(row.data); sessions[hydrated.id]=hydrated; } return {sessions}; }
async function saveSession(session){ session.updatedAt=nowIso(); if(!session.questionSet) session.questionSet=createQuestionSet(session); if(!usePostgres){ memoryDb.sessions[session.id]=session; return; } await pool.query(`INSERT INTO sessions (id, code, data, scheduled_at, status, updated_at, created_at) VALUES ($1,$2,$3::jsonb,$4,$5,NOW(),COALESCE($6,NOW())) ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code, data=EXCLUDED.data, scheduled_at=EXCLUDED.scheduled_at, status=EXCLUDED.status, updated_at=NOW()`,[session.id,session.code,JSON.stringify(session),session.scheduledAt||null,getStatus(session),session.createdAt||null]); }
async function deleteSession(sessionId){ if(!usePostgres){ delete memoryDb.sessions[sessionId]; return; } await pool.query('DELETE FROM recoupling_choices WHERE session_id=$1',[sessionId]); await pool.query('DELETE FROM finale_pitches WHERE session_id=$1',[sessionId]); await pool.query('DELETE FROM sessions WHERE id=$1',[sessionId]); }
async function getHostState(key){ if(!usePostgres) return memoryDb.host_state[key] || null; const r=await pool.query('SELECT value FROM host_state WHERE key=$1 LIMIT 1',[key]); return r.rows[0]?.value || null; }
async function setHostState(key,value){ if(!usePostgres){ memoryDb.host_state[key]=value; return; } await pool.query(`INSERT INTO host_state (key,value,updated_at) VALUES ($1,$2::jsonb,NOW()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`,[key,JSON.stringify(value)]); }
async function getSessionById(sessionId){ if(!usePostgres) return memoryDb.sessions[sessionId] || null; const r=await pool.query('SELECT data FROM sessions WHERE id=$1 LIMIT 1',[sessionId]); return hydrateSessionExtras(r.rows[0]?.data || null); }
async function getSessionByCodeValue(codeValue){ const upper=String(codeValue||'').toUpperCase(); if(!usePostgres) return Object.values(memoryDb.sessions).find(s=>s.code===upper) || null; const r=await pool.query('SELECT data FROM sessions WHERE code=$1 LIMIT 1',[upper]); return hydrateSessionExtras(r.rows[0]?.data || null); }
async function codeExists(codeValue){ return Boolean(await getSessionByCodeValue(codeValue)); }
async function clearActiveSessionIfDeleted(sessionId){ const active=await getHostState('activeSessionId'); if(active?.id===sessionId) await setHostState('activeSessionId',{id:'',updatedAt:nowIso()}); }

function getStatus(session){ if(session.phase==='ended' || session.status==='completed') return 'completed'; if(session.status==='live' || session.phase!=='checkin') return 'live'; if(session.scheduledAt && Date.parse(session.scheduledAt) > Date.now()) return 'upcoming'; return 'waiting'; }

function getLobby(session){
  if(!session || session.phase !== 'checkin' || isCompletedSession(session)) return null;
  const startsAt = session.scheduledAt || '';
  const startMs = startsAt ? Date.parse(startsAt) : 0;
  const remainingMs = startMs ? Math.max(0, startMs - Date.now()) : 0;
  return {
    active: true,
    startsAt,
    remainingMs,
    ready: !startsAt || remainingMs <= 0,
    serverTime: nowIso()
  };
}
function delaySessionStart(session, minutes=5){
  const base = session.scheduledAt && Date.parse(session.scheduledAt) > Date.now() ? Date.parse(session.scheduledAt) : Date.now();
  const next = new Date(base + Math.max(1, Number(minutes||5)) * 60000);
  session.scheduledAt = next.toISOString();
  session.calendarDate = session.calendarDate || next.toISOString().slice(0,10);
  session.startTime = session.startTime || next.toISOString().slice(11,16);
  session.status = 'waiting';
  session.phase = 'checkin';
}
function isCompletedSession(session){ return !session || session.clearedAt || session.phase==='ended' || session.status==='completed' || getStatus(session)==='completed'; }
function isSelectableSession(session){ return session && !isCompletedSession(session); }
function formatShowtime(session){ if(session.showtime) return session.showtime; if(session.calendarDate && session.startTime) return `${session.calendarDate} ${session.startTime}`; if(!session.scheduledAt) return ''; return new Date(session.scheduledAt).toLocaleString('en-US',{dateStyle:'medium',timeStyle:'short'}); }
function coupleName(session,cid){ const c=(session.couples||[]).find(x=>x.id===cid); if(!c) return 'Single'; const names=c.players.map(pid=>session.players[pid]?.name).filter(Boolean); return names.length ? names.join(' + ') : c.name; }
function tallyVotes(session){ const counts={}; for(const c of session.couples||[]) counts[c.id]=0; for(const v of Object.values(session.votes||{})){ if(counts[v.coupleId]!==undefined) counts[v.coupleId]++; } return Object.entries(counts).map(([coupleId,votes])=>({coupleId,coupleName:coupleName(session,coupleId),votes})).sort((a,b)=>b.votes-a.votes); }
function startRecouplingTimer(session, force=false){ if(!force && session.recouplingStartedAt && session.recouplingEndsAt) return; session.recouplingStartedAt=nowIso(); session.recouplingEndsAt=addSeconds(RECOUPLING_SECONDS); session.recouplingLocked=false; session.recouplingRevealed=false; }
function getRecoupling(session, viewerId=null){
  if(session.phase!=='recoupling' && !session.recouplingStartedAt) return null;
  const endsAt=session.recouplingEndsAt||'';
  const locked=Boolean(session.recouplingLocked || (endsAt && Date.parse(endsAt)<=Date.now()));
  const requests=session.recouplingRequests||{};
  const activePlayers=Object.values(session.players||{}).filter(p=>!['dumped','cashedOut'].includes(p.status));
  let viewerChoice = viewerId ? (requests[viewerId] || null) : null;
  const viewer = viewerId ? session.players?.[viewerId] : null;
  if(!viewerChoice && viewer?.lastRecouplingChoice && viewer.lastRecouplingChoice.recouplingStartedAt === (session.recouplingStartedAt||'')) viewerChoice=viewer.lastRecouplingChoice;
  return { startedAt:session.recouplingStartedAt||'', endsAt, locked, revealed:Boolean(session.recouplingRevealed), totalPlayers:activePlayers.length, submittedPlayers:Object.keys(requests).length, viewerChoice };
}
function currentPrompt(session){ const q=getCurrentQuestion(session); if(q) return q.text; const prompts={checkin:'Round 1: Check in, upload a photo, and create your islander profile.',firstImpressions:'Round 2: First impressions. The room sees the islanders before couples form.',firstCoupling:'Round 3: Couple Up. First couples are revealed.',mingle:'Round 4: Mingle Time. Couples talk before the challenges start.',redFlag:'Round 5: Red Flag / Green Flag.',chemistry:'Round 6: Chemistry Check.',spillTea:'Round 7: Spill the Tea.',temptation:'Round 8: Temptation / Switch-Up.',recoupling:'Round 9: Recoupling. Stay loyal, switch, or go single.',cashout:'Cash Out or Double Down: finalists decide whether to take the revealed prize or stay for the bigger mystery prize.',survival:'Rolling Island Survival: every two challenges can remove one couple until two remain.',finale:'Finale Pitch.',winnerVote:'Final two are locked in. Vote for the Bar Island Champions.',ended:'Game ended. Congratulations to the Bar Island Champions.'}; return prompts[session.phase] || 'Wait for the host to start the next Bar Island moment.'; }

function ensureCashout(session){
  session.cashout=session.cashout||{};
  session.cashout.enabled=true;
  session.cashout.sessionNumber=Number(session.cashout.sessionNumber||0);
  session.cashout.active=Boolean(session.cashout.active);
  session.cashout.locked=Boolean(session.cashout.locked);
  session.cashout.prizes=session.cashout.prizes||{};
  session.cashout.prizes.session1=session.cashout.prizes.session1||'';
  session.cashout.prizes.session2=session.cashout.prizes.session2||'';
  session.cashout.prizes.final=session.cashout.prizes.final||'';
  session.cashout.finalPrizeRevealed=Boolean(session.cashout.finalPrizeRevealed);
  session.cashout.decisions=session.cashout.decisions||{};
  session.cashout.history=session.cashout.history||[];
  return session.cashout;
}
function cashoutPublic(session, viewerId=null, hostView=false){
  const c=ensureCashout(session);
  const sessionNumber=Number(c.sessionNumber||0);
  const prize = sessionNumber===1 ? c.prizes.session1 : sessionNumber===2 ? c.prizes.session2 : '';
  const viewerDecision = viewerId && c.decisions ? (c.decisions[viewerId] || null) : null;
  const activeCoupleIds=new Set(activeCouples(session).map(x=>x.id));
  const byCouple={};
  for(const d of Object.values(c.decisions||{})){
    if(!d || !d.coupleId || !activeCoupleIds.has(d.coupleId)) continue;
    byCouple[d.coupleId]=byCouple[d.coupleId]||{coupleId:d.coupleId,coupleName:coupleName(session,d.coupleId),cashout:false,doubleDown:0,total:0,decisions:[]};
    byCouple[d.coupleId].total++;
    if(d.choice==='cashout') byCouple[d.coupleId].cashout=true;
    if(d.choice==='doubleDown') byCouple[d.coupleId].doubleDown++;
    byCouple[d.coupleId].decisions.push({playerId:d.playerId,playerName:d.playerName,choice:d.choice,at:d.updatedAt||d.createdAt});
  }
  return {
    enabled:Boolean(c.enabled), active:Boolean(c.active), locked:Boolean(c.locked), sessionNumber, prize, session1Prize:hostView?(c.prizes.session1||''):'', session2Prize:hostView?(c.prizes.session2||''):'',
    finalPrize: (hostView || c.finalPrizeRevealed || session.phase==='ended') ? (c.prizes.final||'') : '',
    finalPrizeHidden: !(hostView || c.finalPrizeRevealed || session.phase==='ended'),
    finalPrizeRevealed:Boolean(c.finalPrizeRevealed || session.phase==='ended'),
    viewerDecision, decisionsByCouple:Object.values(byCouple), history:c.history||[]
  };
}
function openCashout(session, sessionNumber){
  const c=ensureCashout(session);
  c.active=true; c.locked=false; c.sessionNumber=Number(sessionNumber||1); c.openedAt=nowIso();
  c.decisions={};
  session.phase='cashout'; session.status='live';
  c.history.push({at:nowIso(),action:'openCashout',sessionNumber:c.sessionNumber,prize:c.sessionNumber===1?c.prizes.session1:c.prizes.session2});
}
function lockCashout(session){
  const c=ensureCashout(session);
  c.locked=true; c.active=false; c.lockedAt=nowIso();
  const activeIds=new Set(activeCouples(session).map(x=>x.id));
  const cashoutCoupleIds=new Set();
  const doubleDownCoupleIds=new Set();
  for(const d of Object.values(c.decisions||{})){
    if(!d || !d.coupleId || !activeIds.has(d.coupleId)) continue;
    if(d.choice==='cashout') cashoutCoupleIds.add(d.coupleId);
    if(d.choice==='doubleDown') doubleDownCoupleIds.add(d.coupleId);
  }
  const cashed=[];
  for(const cid of cashoutCoupleIds){
    const couple=(session.couples||[]).find(x=>x.id===cid);
    if(!couple) continue;
    const name=coupleName(session,cid);
    couple.players.forEach(pid=>{ if(session.players[pid]) { session.players[pid].status='cashedOut'; session.players[pid].coupleId=null; }});
    session.couples=(session.couples||[]).filter(x=>x.id!==cid);
    cashed.push({coupleId:cid,coupleName:name,players:couple.players});
  }
  for(const cid of doubleDownCoupleIds){ const couple=(session.couples||[]).find(x=>x.id===cid); if(couple) couple.doubleDown=true; }
  ensureRolling(session);
  session.rolling.replacementCouplesNeeded=Number(session.rolling.replacementCouplesNeeded||0)+cashed.length;
  session.rolling.replacementPlayersNeeded=Number(session.rolling.replacementPlayersNeeded||0)+(cashed.length*2);
  if(cashed.length) session.rolling.stage='replacement';
  c.history.push({at:nowIso(),action:'lockCashout',sessionNumber:c.sessionNumber,cashedOut:cashed,remainingCouples:activeCouples(session).length});
  return cashed;
}


function ensureAutomation(session){
  session.automation=session.automation||{};
  session.automation.mode=session.automation.mode||'manual';
  session.automation.enabled=session.automation.mode==='automated' || session.automation.enabled===true;
  session.automation.paused=Boolean(session.automation.paused);
  session.automation.autoDump=session.automation.autoDump!==false;
  session.automation.startedAt=session.automation.startedAt||'';
  session.automation.lastAction=session.automation.lastAction||'';
  session.automation.nextActionAt=session.automation.nextActionAt||'';
  session.automation.history=session.automation.history||[];
  return session.automation;
}
function pushAutoHistory(session, action, note=''){
  const a=ensureAutomation(session);
  a.lastAction=action;
  a.history.push({at:nowIso(), action, note, phase:session.phase});
  if(a.history.length>50) a.history=a.history.slice(-50);
}
function setAutoWait(session, seconds, action='wait'){
  const a=ensureAutomation(session);
  a.nextActionAt=addSeconds(Math.max(1, Number(seconds||1)));
  pushAutoHistory(session, action, `next in ${seconds}s`);
}
function ensureVote(session, force=false, seconds=null, category='audience'){
  session.vote=session.vote||{};
  const expired=session.vote.endsAt && Date.parse(session.vote.endsAt)<=Date.now();
  if(force || !session.vote.active || expired){
    session.vote.active=true;
    session.vote.locked=false;
    session.vote.revealed=false;
    session.vote.category=category;
    session.vote.startedAt=nowIso();
    session.vote.endsAt=addSeconds(seconds || (session.phase==='winnerVote'?WINNER_VOTE_SECONDS:VOTE_SECONDS));
    session.vote.roundKey=`${session.phase}_${session.vote.startedAt}`;
  }
  return session.vote;
}
function getVote(session){
  const v=session.vote||{};
  const locked=Boolean(v.locked || (v.endsAt && Date.parse(v.endsAt)<=Date.now()));
  return {active:Boolean(v.active), locked, revealed:Boolean(v.revealed), category:v.category||'', startedAt:v.startedAt||'', endsAt:v.endsAt||'', roundKey:v.roundKey||`${session.phase}`};
}
function clearVote(session){ session.vote={active:false,locked:false,revealed:false,category:'',startedAt:'',endsAt:'',roundKey:''}; }
function shouldAutoDump(session){
  const a=ensureAutomation(session);
  if(!a.enabled || !a.autoDump) return 0;
  if(session.phase==='spillTea' && activeCouples(session).length>3) return Math.min(3, activeCouples(session).length-3);
  if(session.phase==='survival'){
    ensureRolling(session);
    const challenges=Number(session.rolling.survivalChallengeCount||0);
    const since=challenges-Number(session.rolling.lastDumpAfterChallenge||0);
    if(since>=2 && activeCouples(session).length>2) return 1;
  }
  return 0;
}
function performAutoDump(session){
  const count=shouldAutoDump(session);
  if(!count) return [];
  const dumped=dumpLowest(session,count,count===3?'autoDumpBottom3':'autoDumpLowest');
  ensureRolling(session);
  if(count===3){
    session.rolling.enabled=true;
    session.rolling.stage='replacement';
    session.rolling.replacementCouplesNeeded=Number(session.rolling.replacementCouplesNeeded||0)+dumped.length;
    session.rolling.replacementPlayersNeeded=Number(session.rolling.replacementPlayersNeeded||0)+(dumped.length*2);
  } else {
    session.rolling.lastDumpAfterChallenge=Number(session.rolling.survivalChallengeCount||0);
    if(activeCouples(session).length<=2){ session.rolling.finalTwo=true; session.rolling.stage='finalTwo'; }
  }
  pushAutoHistory(session, 'autoDump', dumped.map(c=>c.name).join(', '));
  return dumped;
}
function nextAutoPhase(session){
  const sequence={ firstImpressions:'firstCoupling', firstCoupling:'mingle', mingle:'redFlag', redFlag:'chemistry', chemistry:'spillTea', spillTea:'temptation', temptation:'recoupling', recoupling:'survival', survival:'survival', finale:'winnerVote', winnerVote:'ended' };
  return sequence[session.phase] || '';
}
function lockCurrentQuestionIfExpired(session){
  if(!session.currentQuestionId || !session.questionEndsAt) return false;
  if(Date.parse(session.questionEndsAt)<=Date.now()){
    session.questionLocked=true;
    session.hostShowAnswers=true;
    return true;
  }
  return false;
}
async function autoTickSession(session){
  if(!session || isCompletedSession(session)) return false;
  const a=ensureAutomation(session);
  if(!a.enabled || a.mode!=='automated' || a.paused) return false;
  let changed=false;
  // Scheduled lobby auto start.
  if(session.phase==='checkin'){
    const startMs=session.scheduledAt ? Date.parse(session.scheduledAt) : 0;
    if(!startMs || startMs<=Date.now()){
      advancePhase(session,'firstImpressions');
      setAutoWait(session,AUTO_TIMERS.firstImpressions,'autoStartFirstImpressions');
      changed=true;
    }
    return changed;
  }
  // Wait phases.
  if(['firstImpressions','firstCoupling'].includes(session.phase)){
    if(!a.nextActionAt) setAutoWait(session, session.phase==='firstImpressions'?AUTO_TIMERS.firstImpressions:AUTO_TIMERS.firstCoupling, 'autoWait');
    if(Date.parse(a.nextActionAt)<=Date.now()){
      if(session.phase==='firstCoupling') pairPlayers(session);
      advancePhase(session,nextAutoPhase(session));
      if(session.phase==='mingle') startMingleTimer(session,true);
      setAutoWait(session, session.phase==='mingle'?MINGLE_SECONDS:AUTO_TIMERS.firstCoupling, 'autoAdvance');
      changed=true;
    }
    return changed;
  }
  if(session.phase==='mingle'){
    if(!session.mingleEndsAt) startMingleTimer(session,true);
    if(Date.parse(session.mingleEndsAt)<=Date.now()){
      advancePhase(session,'redFlag');
      clearVote(session);
      changed=true;
    }
    return changed;
  }
  if(isQuestionPhase(session.phase)){
    if(!session.currentQuestionId) { startQuestionTimer(session,session.phase,true); changed=true; }
    if(lockCurrentQuestionIfExpired(session)){
      const v=getVote(session);
      if(!v.active){ ensureVote(session,true, session.phase==='finale'?WINNER_VOTE_SECONDS:VOTE_SECONDS, session.phase==='finale'?'winner':'audience'); changed=true; }
    }
    const v=getVote(session);
    if(v.active && !v.locked && v.endsAt && Date.parse(v.endsAt)<=Date.now()){
      session.vote.locked=true;
      session.vote.revealed=true;
      const dumped=performAutoDump(session);
      const next=nextAutoPhase(session);
      if(session.phase==='survival'){
        if(activeCouples(session).length<=2){ advancePhase(session,'finale'); }
        else { // stay in survival and start another challenge after reveal pause
          session.survivalQuestionPointer=Number(session.survivalQuestionPointer||0)+1;
          ensureRolling(session); session.rolling.survivalChallengeCount=Number(session.rolling.survivalChallengeCount||0)+1;
          setAutoWait(session,AUTO_REVEAL_SECONDS,'autoSurvivalReveal');
        }
      } else if(session.phase==='finale') advancePhase(session,'winnerVote');
      else if(next) advancePhase(session,next);
      clearVote(session);
      changed=true;
    }
    return changed;
  }
  if(session.phase==='recoupling'){
    const rec=getRecoupling(session);
    if(rec?.locked || (rec?.endsAt && Date.parse(rec.endsAt)<=Date.now())){
      session.recouplingLocked=true;
      ensureRolling(session); session.rolling.stage='survival'; session.rolling.survivalActive=true; session.rolling.survivalChallengeCount=Number(session.rolling.survivalChallengeCount||0)+1;
      advancePhase(session,'survival');
      startQuestionTimer(session,'survival',true);
      clearVote(session);
      changed=true;
    }
    return changed;
  }
  if(session.phase==='winnerVote'){
    const v=ensureVote(session,false,WINNER_VOTE_SECONDS,'winner');
    if(v.endsAt && Date.parse(v.endsAt)<=Date.now()){
      session.vote.locked=true; session.vote.revealed=true;
      session.winner=tallyVotes(session)[0]||null;
      ensureCashout(session).finalPrizeRevealed=true;
      advancePhase(session,'ended');
      changed=true;
    }
  }
  return changed;
}
async function autoTickAll(){
  const db=await loadDb();
  for(const session of Object.values(db.sessions)){
    if(await autoTickSession(session)) await saveSession(session);
  }
}

function publicSession(session,viewerId=null){
  const q=getCurrentQuestion(session);
  const couples=(session.couples||[]).map(c=>({...c,players:c.players.map(pid=>session.players[pid]).filter(Boolean).map(p=>({id:p.id,name:p.name,bio:p.bio,greenFlag:p.greenFlag,redFlag:p.redFlag,type:p.type,pickup:p.pickup,photoData:p.photoData||'',status:p.status}))}));
  const players=Object.values(session.players||{}).map(p=>({id:p.id,name:p.name,bio:p.bio,greenFlag:p.greenFlag,redFlag:p.redFlag,type:p.type,pickup:p.pickup,photoData:p.photoData||'',status:p.status,coupleId:p.coupleId||null,isViewer:p.id===viewerId}));
  const viewerAnswer = viewerId && q ? (Object.values(session.challengeAnswers||{}).find(a=>a.questionId===q.id && a.playerId===viewerId) || null) : null;
  const viewerFinalePitch = viewerId ? (Object.values(session.finalePitches||{}).find(a=>a.playerId===viewerId && (!q || a.questionId===q.id || a.phase==='finale')) || session.players?.[viewerId]?.lastFinalePitch || null) : null;
  const finalePitches = Object.values(session.finalePitches||{}).sort((a,b)=>String(a.createdAt||'').localeCompare(String(b.createdAt||'')));
  const viewerVoteKey = viewerId ? `player_${viewerId}_${session.phase}` : '';
  const viewerAudienceVoteKey = viewerId ? `audience_${viewerId}_${session.phase}` : '';
  const viewerVote = viewerId ? (session.votes?.[viewerVoteKey] || session.votes?.[viewerAudienceVoteKey] || null) : null;
  return { id:session.id, code:session.code, title:session.title, status:getStatus(session), phase:session.phase, round:session.round, runtimeMinutes:session.runtimeMinutes, maxPlayers:session.maxPlayers, createdAt:session.createdAt, scheduledAt:session.scheduledAt||'', calendarDate:session.calendarDate||'', startTime:session.startTime||'', showtime:formatShowtime(session), serverTime:nowIso(), lobby:getLobby(session), players, couples, audienceCount:Object.keys(session.audience||{}).length, voteCounts:tallyVotes(session), vote:getVote(session), automation:ensureAutomation(session), viewerVote, challengeAnswers:getAnswerRows(session), viewerAnswer, viewerFinalePitch, finalePitches, answerProgress:getProgress(session), recouplingRequests:session.recouplingRequests||{}, currentRecoupling:getRecoupling(session,viewerId), winner:session.winner||null, currentPrompt:currentPrompt(session), currentQuestion:q, currentMingle:getMingle(session), questionSet:(session.questionSet||[]).map(q=>({id:q.id,cat:q.cat,type:q.type,seconds:q.seconds,text:q.text,phase:q.phase})), currentQuestionIndex:session.currentQuestionIndex||0, rules:session.rules, rolling:session.rolling||null, cashout:cashoutPublic(session,viewerId, false), storage:usePostgres?'postgres':'memory' };
}
function makeSession(body={}){ const createdAt=nowIso(); const scheduledAt=clean(body.scheduledAt||''); const session={ id:id('session'), code:body.code ? clean(body.code).toUpperCase().slice(0,8) : code(), title:clean(body.title||'Bar Island'), status:'waiting', phase:'checkin', round:0, runtimeMinutes:Number(body.runtimeMinutes||45), maxPlayers:Number(body.maxPlayers||12), calendarDate:clean(body.calendarDate||''), startTime:clean(body.startTime||''), scheduledAt, showtime:clean(body.showtime||''), questionMode:clean(body.questionMode||'fresh'), createdAt, updatedAt:createdAt, players:{}, audience:{}, couples:[], votes:{}, challengeAnswers:{}, finalePitches:{}, recouplingRequests:{}, recouplingStartedAt:'', recouplingEndsAt:'', recouplingLocked:false, recouplingRevealed:false, hostShowAnswers:false, winner:null, rolling:{enabled:false,stage:'single',firstDumpCount:3,replacementCouplesNeeded:0,replacementPlayersNeeded:0,survivalActive:false,survivalChallengeCount:0,lastDumpAfterChallenge:0,finalTwo:false,history:[]}, survivalQuestionPointer:0, currentQuestionId:'', currentQuestionIndex:0, questionStartedAt:'', questionEndsAt:'', questionLocked:false, mingleStartedAt:'', mingleEndsAt:'', cashout:{enabled:true,active:false,locked:false,sessionNumber:0,openedAt:'',lockedAt:'',prizes:{session1:'',session2:'',final:''},finalPrizeRevealed:false,decisions:{},history:[]}, vote:{active:false,locked:false,revealed:false,category:'',startedAt:'',endsAt:'',roundKey:''}, automation:{mode:clean(body.gameMode||body.automationMode||'manual'),enabled:String(body.gameMode||body.automationMode||'manual')==='automated',paused:false,autoDump:String(body.autoDump||'on')!=='off',startedAt:'',lastAction:'',nextActionAt:'',history:[]}, rules:{playersCannotVoteOwnCouple:true,audienceCanVoteAnyCouple:true,maxCouples:6,minPlayers:6,idealPlayers:10} }; session.questionSet=createQuestionSet(session,session.questionMode); return session; }
function pairPlayers(session){ const active=Object.values(session.players||{}).filter(p=>!['dumped','cashedOut'].includes(p.status)); active.forEach(p=>p.coupleId=null); const shuffled=[...active].sort((a,b)=>a.joinedAt.localeCompare(b.joinedAt)); const couples=[]; while(shuffled.length){ const a=shuffled.shift(); const b=shuffled.shift(); const cid=id('couple'); const players=b?[a.id,b.id]:[a.id]; players.forEach(pid=>session.players[pid].coupleId=cid); couples.push({id:cid,name:players.map(pid=>session.players[pid].name).join(' + ')||'New Couple',players,safe:false}); } session.couples=couples; }

function activeCouples(session){ return (session.couples||[]).filter(c=>c.players.some(pid=>!['dumped','cashedOut'].includes(session.players[pid]?.status))); }
function bottomCouples(session,count){
  const counts={}; for(const c of activeCouples(session)) counts[c.id]=0;
  for(const v of Object.values(session.votes||{})){ if(counts[v.coupleId]!==undefined) counts[v.coupleId]++; }
  return activeCouples(session).map((c,idx)=>({couple:c,votes:counts[c.id]||0,idx})).sort((a,b)=>a.votes-b.votes || a.idx-b.idx).slice(0,count).map(x=>x.couple);
}
function dumpCoupleObject(session,c,reason='dumped'){
  if(!c) return null;
  c.players.forEach(pid=>{ if(session.players[pid]) { session.players[pid].status='dumped'; session.players[pid].coupleId=null; }});
  session.couples=(session.couples||[]).filter(x=>x.id!==c.id);
  session.rolling=session.rolling||{};
  session.rolling.history=session.rolling.history||[];
  session.rolling.history.push({at:nowIso(),action:reason,coupleId:c.id,coupleName:coupleName(session,c.id)||c.name,players:c.players});
  return c;
}
function dumpLowest(session,count,reason='dumpLowest'){
  const picked=bottomCouples(session, count);
  picked.forEach(c=>dumpCoupleObject(session,c,reason));
  return picked;
}
function pairNewPlayers(session){
  const unpaired=Object.values(session.players||{}).filter(p=>!['dumped','cashedOut'].includes(p.status) && !p.coupleId).sort((a,b)=>a.joinedAt.localeCompare(b.joinedAt));
  const made=[];
  while(unpaired.length){
    const a=unpaired.shift(); const b=unpaired.shift();
    const cid=id('couple'); const players=b?[a.id,b.id]:[a.id];
    players.forEach(pid=>session.players[pid].coupleId=cid);
    const c={id:cid,name:players.map(pid=>session.players[pid].name).join(' + ')||'Bombshell Couple',players,safe:false,bombshell:true,enteredAt:nowIso()};
    session.couples.push(c); made.push(c);
  }
  if(session.rolling){ session.rolling.replacementPlayersNeeded=Math.max(0, Number(session.rolling.replacementPlayersNeeded||0) - made.reduce((n,c)=>n+c.players.length,0)); session.rolling.replacementCouplesNeeded=Math.max(0, Number(session.rolling.replacementCouplesNeeded||0) - made.length); }
  return made;
}
function ensureRolling(session){
  session.rolling=session.rolling||{};
  Object.assign(session.rolling,{enabled:true,stage:session.rolling.stage||'rolling',firstDumpCount:Number(session.rolling.firstDumpCount||3),replacementCouplesNeeded:Number(session.rolling.replacementCouplesNeeded||0),replacementPlayersNeeded:Number(session.rolling.replacementPlayersNeeded||0),survivalActive:Boolean(session.rolling.survivalActive),survivalChallengeCount:Number(session.rolling.survivalChallengeCount||0),lastDumpAfterChallenge:Number(session.rolling.lastDumpAfterChallenge||0),finalTwo:Boolean(session.rolling.finalTwo),history:session.rolling.history||[]});
  session.rules=session.rules||{}; session.rules.rollingIslandMode=true;
}
function advancePhase(session,phase){ const previousPhase=session.phase; const samePhase=previousPhase===phase; session.phase=phase; session.status=phase==='ended'?'completed':'live'; const roundMap={checkin:1,firstImpressions:2,firstCoupling:3,mingle:4,redFlag:5,chemistry:6,spillTea:7,temptation:8,recoupling:9,cashout:10,survival:10,finale:10,vote:10,winnerVote:10,ended:10}; session.round=roundMap[phase] ?? session.round; if(!samePhase){ session.votes={}; clearVote(session); } if(isQuestionPhase(phase)){ if(!samePhase || !session.currentQuestionId) startQuestionTimer(session,phase,true); } else { session.currentQuestionId=''; session.questionStartedAt=''; session.questionEndsAt=''; session.questionLocked=false; } if(phase==='mingle' && (!samePhase || !session.mingleEndsAt)) startMingleTimer(session,true); if(phase!=='mingle'){ session.mingleStartedAt=session.mingleStartedAt||''; } if(phase==='recoupling'){
    if(!samePhase){
      session.recouplingRequests={};
      Object.values(session.players||{}).forEach(p=>{ if(p) delete p.lastRecouplingChoice; });
      startRecouplingTimer(session,true);
    } else { startRecouplingTimer(session,false); }
  } }
function asyncHandler(fn){ return (req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next); }

app.get('/api/health', asyncHandler(async(req,res)=>{ if(usePostgres) await pool.query('SELECT 1'); res.json({ok:true,storage:usePostgres?'postgres':'memory',serverTime:nowIso(),questionPool:QUESTION_POOL.length}); }));
app.get('/api/time',(req,res)=>res.json({serverTime:nowIso()}));
app.get('/api/questions',(req,res)=>res.json({count:QUESTION_POOL.length,categories:{compatibility:40,spill:25,redflag:15,audience:10,finale:10},phases:QUESTION_PHASES,questions:QUESTION_POOL.map(q=>({id:q.id,cat:q.cat,type:q.type,seconds:q.seconds,text:q.text}))}));
app.get('/api/qr.svg', asyncHandler(async(req,res)=>{ const text=String(req.query.text || `${req.protocol}://${req.get('host')}/`).slice(0,500); const svg=await QRCode.toString(text,{type:'svg',margin:1,color:{dark:'#12051f',light:'#ffffff'}}); res.type('image/svg+xml').send(svg); }));
app.post('/api/host/login',(req,res)=>{ if(String(req.body.pin||'')!==HOST_PIN) return res.status(401).json({error:'Incorrect PIN. Try again.'}); res.json({ok:true}); });
app.get('/api/sessions', asyncHandler(async(req,res)=>{ await autoTickAll(); const db=await loadDb(); const raw=Object.values(db.sessions).sort((a,b)=>(a.scheduledAt||a.createdAt).localeCompare(b.scheduledAt||b.createdAt)); let activeState=await getHostState('activeSessionId'); let activeSessionId=activeState?.id||''; const activeSession=activeSessionId ? raw.find(s=>s.id===activeSessionId) : null; if(activeSessionId && (!activeSession || isCompletedSession(activeSession))){ activeSessionId=''; await setHostState('activeSessionId',{id:'',updatedAt:nowIso(),reason:'cleared_or_completed'}); } if(!activeSessionId && raw.length){ const selectable=raw.filter(isSelectableSession); const live=selectable.find(s=>getStatus(s)==='live'); const upcoming=selectable.find(s=>['upcoming','waiting'].includes(getStatus(s))); const next=live||upcoming||null; if(next){ activeSessionId=next.id; await setHostState('activeSessionId',{id:activeSessionId,updatedAt:nowIso(),reason:'auto_selected_selectable'}); } } const hostView=String(req.headers['x-host-pin']||'')===HOST_PIN; res.json({serverTime:nowIso(),storage:usePostgres?'postgres':'memory',activeSessionId,sessions:raw.map(s=>publicSession(s,null,hostView))}); }));
app.post('/api/sessions', hostOnly, asyncHandler(async(req,res)=>{ let session=makeSession(req.body||{}); while(await codeExists(session.code)) session.code=code(); await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session),activeSessionId:session.id}); }));
app.get('/api/session/:code', asyncHandler(async(req,res)=>{ await autoTickAll(); const session=await getSessionByCodeValue(req.params.code); if(!session) return res.status(404).json({error:'This game session has ended or was cleared.', ended:true}); if(session.clearedAt) return res.status(410).json({error:'This game session has ended or was cleared.', ended:true}); res.json({session:publicSession(session,req.query.viewerId)}); }));
app.post('/api/join', asyncHandler(async(req,res)=>{ const session=await getSessionByCodeValue(req.body.code); if(!session) return res.status(404).json({error:'Session not found.'}); const existing=Object.values(session.players||{}).find(p=>p.phone && p.phone===clean(req.body.phone)); if(existing) return res.json({player:existing,session:publicSession(session,existing.id)}); const activeCount=Object.values(session.players||{}).filter(p=>!['dumped','cashedOut'].includes(p.status)).length; if(activeCount>=session.maxPlayers) return res.status(400).json({error:'This island is full.'}); const player={id:id('player'),name:clean(req.body.name||'Islander'),phone:clean(req.body.phone||''),bio:clean(req.body.bio||''),type:clean(req.body.type||''),greenFlag:clean(req.body.greenFlag||''),redFlag:clean(req.body.redFlag||''),pickup:clean(req.body.pickup||''),photoData:cleanPhoto(req.body.photoData||''),status:'active',coupleId:null,joinedAt:nowIso()}; session.players[player.id]=player; await saveSession(session); res.json({player,session:publicSession(session,player.id)}); }));
app.post('/api/audience', asyncHandler(async(req,res)=>{ const session=await getSessionByCodeValue(req.body.code); if(!session) return res.status(404).json({error:'Session not found.'}); const audience={id:id('aud'),name:clean(req.body.name||'Audience'),joinedAt:nowIso()}; session.audience[audience.id]=audience; await saveSession(session); res.json({audience,session:publicSession(session)}); }));
app.post('/api/host/active', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(clean(req.body.sessionId||'')); if(!session) return res.status(404).json({error:'Session not found.'}); if(isCompletedSession(session)) return res.status(400).json({error:'Completed sessions cannot be made active. Create or select an upcoming/live game.'}); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({ok:true,activeSessionId:session.id,session:publicSession(session)}); }));

app.post('/api/host/:id/automation', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); const a=ensureAutomation(session); const action=clean(req.body.action||''); if(action==='enable'){ a.mode='automated'; a.enabled=true; a.paused=false; pushAutoHistory(session,'enableAutomation'); } if(action==='manual'){ a.mode='manual'; a.enabled=false; a.paused=false; pushAutoHistory(session,'manualMode'); } if(action==='pause'){ a.paused=true; pushAutoHistory(session,'pauseAutomation'); } if(action==='resume'){ a.mode='automated'; a.enabled=true; a.paused=false; pushAutoHistory(session,'resumeAutomation'); } if(action==='toggleAutoDump'){ a.autoDump=!a.autoDump; pushAutoHistory(session,'toggleAutoDump',String(a.autoDump)); } await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/vote/start', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); ensureVote(session,true,Number(req.body.seconds||VOTE_SECONDS),clean(req.body.category||'audience')); await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/vote/add-time', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); ensureVote(session,false,VOTE_SECONDS); const addMs=Number(req.body.seconds||30)*1000; const base=session.vote.endsAt && Date.parse(session.vote.endsAt)>Date.now()?Date.parse(session.vote.endsAt):Date.now(); session.vote.endsAt=new Date(base+addMs).toISOString(); session.vote.locked=false; await saveSession(session); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/vote/lock', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); ensureVote(session,false,VOTE_SECONDS); session.vote.locked=true; session.vote.revealed=true; await saveSession(session); res.json({session:publicSession(session)}); }));

app.get('/api/host/state', hostOnly, asyncHandler(async(req,res)=>{ const activeState=await getHostState('activeSessionId'); const activeSession=activeState?.id ? await getSessionById(activeState.id) : null; res.json({storage:usePostgres?'postgres':'memory',activeSessionId:activeState?.id||'',activeSession:activeSession?publicSession(activeSession):null,serverTime:nowIso()}); }));
app.post('/api/host/:id/phase', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); const requestedPhase=clean(req.body.phase); let phase=requestedPhase; if(requestedPhase==='firstCoupling'){ pairPlayers(session); phase='firstCoupling'; } if(phase==='ended'){ session.winner=tallyVotes(session)[0]||null; ensureCashout(session).finalPrizeRevealed=true; } advancePhase(session,phase); await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));

app.post('/api/host/:id/start-now', hostOnly, asyncHandler(async(req,res)=>{
  const session=await getSessionById(req.params.id);
  if(!session) return res.status(404).json({error:'Session not found.'});
  session.scheduledAt = nowIso();
  if(session.phase==='checkin') advancePhase(session,'firstImpressions');
  await saveSession(session);
  await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()});
  res.json({session:publicSession(session)});
}));
app.post('/api/host/:id/delay-start', hostOnly, asyncHandler(async(req,res)=>{
  const session=await getSessionById(req.params.id);
  if(!session) return res.status(404).json({error:'Session not found.'});
  delaySessionStart(session, Number(req.body.minutes||5));
  await saveSession(session);
  await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()});
  res.json({session:publicSession(session)});
}));
app.post('/api/host/:id/pair', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); pairPlayers(session); advancePhase(session,'firstCoupling'); await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/reveal', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); session.hostShowAnswers=Boolean(req.body.show); await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/reset-question', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); if(!isQuestionPhase(session.phase)) return res.status(400).json({error:'No active question timer in this phase.'}); startQuestionTimer(session,session.phase,true); await saveSession(session); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/mingle/add-minute', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); if(session.phase!=='mingle') advancePhase(session,'mingle'); addMingleMinute(session); await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/dump', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); const c=(session.couples||[]).find(x=>x.id===clean(req.body.coupleId)); if(c) c.players.forEach(pid=>{ if(session.players[pid]) session.players[pid].status='dumped'; }); session.couples=(session.couples||[]).filter(x=>x.id!==clean(req.body.coupleId)); await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));

app.post('/api/host/:id/clear-current', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(session){ session.status='completed'; session.phase='ended'; session.clearedAt=nowIso(); session.currentQuestionId=''; session.questionStartedAt=''; session.questionEndsAt=''; session.questionLocked=true; session.mingleEndsAt=''; session.recouplingEndsAt=''; await saveSession(session); } await setHostState('activeSessionId',{id:'',updatedAt:nowIso(),reason:'clear_current'}); res.json({ok:true,clearedSessionId:req.params.id}); }));
app.post('/api/host/delete-completed', hostOnly, asyncHandler(async(req,res)=>{
  const activeState=await getHostState('activeSessionId');
  if(!usePostgres){
    let deleted=0;
    for(const [sid,s] of Object.entries(memoryDb.sessions)){
      if(isCompletedSession(s)){ delete memoryDb.sessions[sid]; deleted++; }
    }
    if(activeState?.id && !memoryDb.sessions[activeState.id]) await setHostState('activeSessionId',{id:'',updatedAt:nowIso(),reason:'delete_completed'});
    return res.json({ok:true,deleted});
  }
  const completedWhere="status='completed' OR (data->>'phase')='ended' OR (data->>'status')='completed' OR (data ? 'clearedAt')";
  await pool.query(`DELETE FROM finale_pitches WHERE session_id IN (SELECT id FROM sessions WHERE ${completedWhere})`);
  await pool.query(`DELETE FROM recoupling_choices WHERE session_id IN (SELECT id FROM sessions WHERE ${completedWhere})`);
  const r=await pool.query(`DELETE FROM sessions WHERE ${completedWhere}`);
  if(activeState?.id){
    const stillThere=await getSessionById(activeState.id);
    if(!stillThere || isCompletedSession(stillThere)) await setHostState('activeSessionId',{id:'',updatedAt:nowIso(),reason:'delete_completed'});
  }
  res.json({ok:true,deleted:r.rowCount});
}));
app.post('/api/host/clear-stale-state', hostOnly, asyncHandler(async(req,res)=>{
  await setHostState('activeSessionId',{id:'',updatedAt:nowIso(),reason:'manual_clear_stale_state'});
  res.json({ok:true});
}));
app.post('/api/host/:id/rolling/start', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); ensureRolling(session); session.rolling.stage='rolling'; await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/rolling/dump-bottom-3', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); ensureRolling(session); const count=Math.min(3, Math.max(0, activeCouples(session).length-2)); const dumped=dumpLowest(session,count,'firstDumpBottom3'); session.rolling.stage='replacement'; session.rolling.replacementCouplesNeeded=dumped.length; session.rolling.replacementPlayersNeeded=dumped.length*2; session.votes={}; await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session),dumped:dumped.map(c=>c.name)}); }));
app.post('/api/host/:id/rolling/pair-new', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); ensureRolling(session); const made=pairNewPlayers(session); if(session.rolling.replacementCouplesNeeded===0) session.rolling.stage='replaced'; await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session),made:made.length}); }));
app.post('/api/host/:id/rolling/start-survival', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); ensureRolling(session); session.rolling.stage='survival'; session.rolling.survivalActive=true; session.survivalQuestionPointer=Number(session.survivalQuestionPointer||0); advancePhase(session,'survival'); await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/rolling/next-survival-challenge', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); ensureRolling(session); session.rolling.stage='survival'; session.rolling.survivalActive=true; session.phase='survival'; session.round=10; session.survivalQuestionPointer=Number(session.survivalQuestionPointer||0)+1; session.rolling.survivalChallengeCount=Number(session.rolling.survivalChallengeCount||0)+1; session.votes={}; session.hostShowAnswers=false; startQuestionTimer(session,'survival',true); await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/rolling/dump-lowest-one', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); ensureRolling(session); const active=activeCouples(session).length; if(active<=2) return res.status(400).json({error:'Only two couples remain. Open the final winner vote.'}); const challenges=Number(session.rolling.survivalChallengeCount||0); const since=challenges-Number(session.rolling.lastDumpAfterChallenge||0); if(since<2) return res.status(400).json({error:'Run two survival challenges before dumping the next couple.'}); const dumped=dumpLowest(session,1,'survivalDump'); session.rolling.lastDumpAfterChallenge=challenges; if(activeCouples(session).length<=2){ session.rolling.finalTwo=true; session.rolling.stage='finalTwo'; } session.votes={}; await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session),dumped:dumped.map(c=>c.name)}); }));
app.post('/api/host/:id/rolling/final-vote', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); ensureRolling(session); session.rolling.stage='winnerVote'; session.rolling.finalTwo=activeCouples(session).length<=2; session.phase='winnerVote'; session.round=10; session.votes={}; session.currentQuestionId=''; session.questionStartedAt=''; session.questionEndsAt=''; session.questionLocked=false; await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));

app.post('/api/host/:id/cashout/settings', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); const c=ensureCashout(session); c.prizes.session1=clean(req.body.session1Prize||c.prizes.session1||''); c.prizes.session2=clean(req.body.session2Prize||c.prizes.session2||''); c.prizes.final=clean(req.body.finalPrize||c.prizes.final||''); await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/cashout/open', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); const n=Number(req.body.sessionNumber||1); if(![1,2].includes(n)) return res.status(400).json({error:'Cash out is only for Session 1 or Session 2.'}); ensureCashout(session); openCashout(session,n); await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/cashout/lock', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); const cashed=lockCashout(session); await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session),cashedOut:cashed}); }));
app.post('/api/host/:id/cashout/reveal-final', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); ensureCashout(session).finalPrizeRevealed=true; await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));
app.post('/api/cashout', asyncHandler(async(req,res)=>{ const session=await getSessionByCodeValue(req.body.code); if(!session) return res.status(404).json({error:'Session not found.'}); const c=ensureCashout(session); if(!c.active || c.locked) return res.status(400).json({error:'Cash Out or Double Down is not active right now.'}); const player=session.players[req.body.playerId]; if(!player) return res.status(404).json({error:'Player not found.'}); if(!player.coupleId) return res.status(400).json({error:'You are not in an active couple.'}); const choice=clean(req.body.choice||''); if(!['cashout','doubleDown'].includes(choice)) return res.status(400).json({error:'Choose Cash Out or Double Down.'}); c.decisions[player.id]={playerId:player.id,playerName:player.name,coupleId:player.coupleId,coupleName:coupleName(session,player.coupleId),choice,sessionNumber:c.sessionNumber,createdAt:c.decisions[player.id]?.createdAt||nowIso(),updatedAt:nowIso()}; await saveSession(session); res.json({session:publicSession(session,player.id)}); }));
app.post('/api/host/:id/player/:playerId/remove-photo', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); const player=session.players[req.params.playerId]; if(!player) return res.status(404).json({error:'Player not found.'}); player.photoData=''; await saveSession(session); await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()}); res.json({session:publicSession(session)}); }));
app.post('/api/host/:id/delete', hostOnly, asyncHandler(async(req,res)=>{ const session=await getSessionById(req.params.id); if(!session) return res.status(404).json({error:'Session not found.'}); await deleteSession(req.params.id); await clearActiveSessionIfDeleted(req.params.id); res.json({ok:true}); }));
app.post('/api/answer', asyncHandler(async(req,res)=>{
  const session=await getSessionByCodeValue(req.body.code);
  if(!session) return res.status(404).json({error:'Session not found.'});
  const player=session.players[req.body.playerId];
  if(!player) return res.status(404).json({error:'Player not found.'});
  const coupleId=player.coupleId;
  if(!coupleId) return res.status(400).json({error:'You are not coupled yet.'});
  const q=getCurrentQuestion(session);
  if(!q || !isQuestionPhase(session.phase)) return res.status(400).json({error:'There is no active question right now.'});
  if(q.locked) return res.status(400).json({error:'Time is up for this question.'});
  session.challengeAnswers=session.challengeAnswers||{};
  session.finalePitches=session.finalePitches||{};
  const answerText=clean(req.body.text || req.body.option || '');
  const key=`${q.id}_${player.id}`;
  const answerData={id:session.challengeAnswers[key]?.id || id('answer'),key,questionId:q.id,questionText:q.text,questionType:q.type,playerId:player.id,playerName:player.name,coupleId,coupleName:coupleName(session,coupleId),phase:session.phase,option:clean(req.body.option||''),text:answerText,createdAt:session.challengeAnswers[key]?.createdAt || nowIso(),updatedAt:nowIso()};
  session.challengeAnswers[key]=answerData;
  if(session.phase==='finale' || q.cat==='finale'){
    const pitchData={...answerData, pitch:answerText, savedAs:'finalePitch'};
    session.finalePitches[key]=pitchData;
    player.lastFinalePitch=pitchData;
    await saveFinalePitchRow(session, player.id, pitchData);
  }
  await saveSession(session);
  await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()});
  const fresh=await getSessionById(session.id) || session;
  res.json({session:publicSession(fresh,player.id)});
}));
app.post('/api/vote', asyncHandler(async(req,res)=>{ const session=await getSessionByCodeValue(req.body.code); if(!session) return res.status(404).json({error:'Session not found.'}); const v=getVote(session); if(v.active && v.locked) return res.status(400).json({error:'Voting is closed for this round.'}); const voterType=clean(req.body.voterType||'audience'); const voterId=clean(req.body.voterId||''); const coupleId=clean(req.body.coupleId); if(!(session.couples||[]).some(c=>c.id===coupleId)) return res.status(400).json({error:'Couple not found.'}); if(voterType==='player'){ const p=session.players[voterId]; if(!p) return res.status(404).json({error:'Player not found.'}); if(session.rules.playersCannotVoteOwnCouple && p.coupleId===coupleId) return res.status(400).json({error:'Islanders cannot vote for themselves or their own couple.'}); } const key=`${voterType}_${voterId}_${v.roundKey||session.phase}`; session.votes[key]={voterType,voterId,coupleId,phase:session.phase,voteRoundKey:v.roundKey||session.phase,createdAt:nowIso()}; await saveSession(session); res.json({session:publicSession(session,voterId)}); }));
app.post('/api/recouple', asyncHandler(async(req,res)=>{
  const session=await getSessionByCodeValue(req.body.code);
  if(!session) return res.status(404).json({error:'Session not found.'});
  if(session.phase!=='recoupling') return res.status(400).json({error:'Recoupling is not active right now.'});
  const rec=getRecoupling(session,req.body.playerId);
  if(rec?.locked) return res.status(400).json({error:'Recoupling time is up.'});
  const player=session.players[req.body.playerId];
  if(!player) return res.status(404).json({error:'Player not found.'});
  const choice=clean(req.body.choice||'stay');
  session.recouplingRequests=session.recouplingRequests||{};
  const choiceData={
    playerId:player.id,
    playerName:player.name,
    choice,
    targetPlayerId:clean(req.body.targetPlayerId||''),
    recouplingStartedAt:session.recouplingStartedAt||'',
    sessionId:session.id,
    createdAt:session.recouplingRequests[player.id]?.createdAt || player.lastRecouplingChoice?.createdAt || nowIso(),
    updatedAt:nowIso()
  };
  session.recouplingRequests[player.id]=choiceData;
  player.lastRecouplingChoice=choiceData;
  await saveRecouplingChoiceRow(session, player.id, choiceData);
  await saveSession(session);
  await setHostState('activeSessionId',{id:session.id,updatedAt:nowIso()});
  const fresh=await getSessionById(session.id) || session;
  res.json({session:publicSession(fresh,player.id)});
}));

app.get('/host',(req,res)=>res.sendFile(path.join(__dirname,'public','host.html')));
app.get('/public',(req,res)=>res.sendFile(path.join(__dirname,'public','public.html')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.use((err,req,res,next)=>{ console.error('Server error:',err); res.status(500).json({error:err.message || 'Server error.'}); });
initStorage().then(()=>{ setInterval(()=>autoTickAll().catch(err=>console.error('Auto tick failed:',err.message)), 5000); app.listen(PORT,'0.0.0.0',()=>console.log(`Bar Island running on 0.0.0.0:${PORT}. Storage: ${usePostgres?'PostgreSQL':'memory'}. Question pool: ${QUESTION_POOL.length}`)); }).catch(err=>{ console.error('Failed to initialize storage:',err); process.exit(1); });
