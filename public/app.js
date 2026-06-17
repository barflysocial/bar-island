const $ = (s, r=document) => r.querySelector(s);
const app = $('#app');
const urlParams = new URLSearchParams(location.search);
const prefillCode = (urlParams.get('code') || '').toUpperCase();
if (prefillCode) localStorage.barIslandCode = prefillCode;
const state = {
  code: prefillCode || localStorage.barIslandCode || '',
  playerId: localStorage.barIslandPlayerId || '',
  audienceId: localStorage.barIslandAudienceId || '',
  role: localStorage.barIslandRole || 'player',
  session: null,
  sessions: [],
  serverTime: null,
  tab: 'home',
  timer: null,
  listTimer: null
};
function esc(v=''){ return String(v).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
async function api(url, opts={}){
  const res = await fetch(url, { headers:{'Content-Type':'application/json'}, ...opts });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function toast(msg){ const el=document.createElement('div'); el.className='toast'; el.textContent=msg; document.body.appendChild(el); setTimeout(()=>el.remove(),2600); }
function saveLocal(){ localStorage.barIslandCode=state.code||''; localStorage.barIslandPlayerId=state.playerId||''; localStorage.barIslandAudienceId=state.audienceId||''; localStorage.barIslandRole=state.role||'player'; }
async function loadSessions(){
  try{ const data=await api('/api/sessions'); state.sessions=data.sessions||[]; state.serverTime=data.serverTime; }
  catch{ state.sessions=[]; }
}
function sessionOptions(){
  if(!state.sessions.length) return `<p class="muted">No scheduled games yet. Ask the host for a session code.</p>`;
  return state.sessions.filter(s=>s.status!=='completed').map(s=>`<button type="button" class="secondary session-choice" onclick="chooseCode('${esc(s.code)}')"><span><b>${esc(s.title)}</b><br><small>${esc(s.showtime || 'No time set')}</small></span><span><span class="pill">${esc(s.code)}</span>${countdownPill(s)}</span></button>`).join('');
}
function countdownPill(s){
  if(!s.scheduledAt) return '';
  if(s.status==='live') return '<span class="pill good">Live</span>';
  const diff = new Date(s.scheduledAt).getTime() - Date.now();
  if(diff<=0) return '<span class="pill good">Ready</span>';
  const mins=Math.floor(diff/60000), hrs=Math.floor(mins/60), days=Math.floor(hrs/24);
  const text = days>0 ? `${days}d ${hrs%24}h` : hrs>0 ? `${hrs}h ${mins%60}m` : `${Math.max(0,mins)}m`;
  return `<span class="pill">${text}</span>`;
}
window.chooseCode=(code)=>{ const input=$('input[name="code"]'); if(input){ input.value=code; state.code=code; saveLocal(); } };
async function refresh(silent=true){
  if(!state.code) return;
  try{
    const id = state.role === 'player' ? state.playerId : state.audienceId;
    const data = await api(`/api/session/${encodeURIComponent(state.code)}?viewerId=${encodeURIComponent(id||'')}`);
    state.session=data.session; renderGame();
  }catch(e){ if(!silent) toast(e.message); }
}
function startPolling(){ clearInterval(state.timer); state.timer=setInterval(()=>refresh(true),3500); }
async function landing(){
  clearInterval(state.timer);
  await loadSessions();
  app.innerHTML = `<section class="screen title-only"><div class="hero solo"><img class="title-img" src="/assets/bar-island-title.png" alt="Bar Island title graphic"><div class="home-buttons"><button onclick="showJoin('player')">Join Player</button><button class="teal" onclick="showJoin('audience')">Join Audience Vote</button><button class="secondary" onclick="howToPlay()">How to Play</button><button class="secondary" onclick="shareGame()">Share</button></div></div></section>`;
}
window.howToPlay=()=>{
  app.innerHTML=`<section class="screen"><div class="card"><h1>How to Play</h1><div class="grid"><div class="profile"><b>1. Join</b><span class="muted">Players join with a session code and create a quick islander profile.</span></div><div class="profile"><b>2. Couple Up</b><span class="muted">The host forms couples or repairs couples during the game.</span></div><div class="profile"><b>3. Challenges</b><span class="muted">Couples answer funny bar-friendly prompts.</span></div><div class="profile"><b>4. Vote</b><span class="muted">Players vote for other couples only. Audience voters can vote for anyone.</span></div><div class="profile"><b>5. Recouple</b><span class="muted">Players can stay loyal, switch, steal, or go single.</span></div><div class="profile"><b>6. Finale</b><span class="muted">The final vote crowns the Bar Island Champions.</span></div></div><div class="row"><button onclick="landing()">Back</button></div></div></section>`;
};
window.shareGame=async()=>{
  const data={title:'Bar Island',text:'Join Bar Island.',url: state.code ? `${location.origin}/?code=${encodeURIComponent(state.code)}` : location.origin};
  if(navigator.share){ try{ await navigator.share(data); return; }catch{} }
  await navigator.clipboard.writeText(location.origin).catch(()=>{});
  toast('Share link copied.');
};
window.showJoin = async (role) => {
  state.role = role; saveLocal(); await loadSessions();
  app.innerHTML = `<section class="screen"><div class="card"><h1>${role==='player'?'Join Player':'Join Audience Vote'}</h1><form id="joinForm" class="grid">
    <label>Session Code<input name="code" value="${esc(state.code)}" placeholder="ABC123" required></label>
    <label>Your Name<input name="name" placeholder="Nickname" required></label>
    ${role==='player'?`<label>Phone <input name="phone" placeholder="Used for re-entry"></label><label>Type on Paper<input name="type" placeholder="Funny, loyal, chaotic, mysterious..."></label><label>Green Flag<input name="greenFlag" placeholder="What makes you dateable?"></label><label>Red Flag<input name="redFlag" placeholder="Keep it playful"></label><label>Best Pickup Line<textarea name="pickup" placeholder="Your best clean pickup line"></textarea></label><label>Bio<textarea name="bio" placeholder="One sentence about your islander energy"></textarea></label>`:''}
    <div class="row"><button type="submit">Enter Island</button><button type="button" class="secondary" onclick="landing()">Back</button></div>
  </form></div><div class="card"><h2>Scheduled Games</h2>${sessionOptions()}</div></section>`;
  $('#joinForm').onsubmit = async (ev)=>{
    ev.preventDefault(); const f=Object.fromEntries(new FormData(ev.target).entries()); state.code=f.code.toUpperCase().trim();
    try{
      if(role==='player'){
        const data=await api('/api/join',{method:'POST',body:JSON.stringify(f)}); state.playerId=data.player.id; state.session=data.session;
      }else{
        const data=await api('/api/audience',{method:'POST',body:JSON.stringify(f)}); state.audienceId=data.audience.id; state.session=data.session;
      }
      saveLocal(); renderGame(); startPolling();
    }catch(e){ toast(e.message); }
  };
};
function nav(){
  const tabs = state.role==='player' ? [['home','Island'],['couples','Couples'],['challenge','Challenge'],['vote','Vote'],['recouple','Recouple']] : [['home','Island'],['couples','Couples'],['vote','Vote']];
  return `<div class="nav"><div class="row between"><strong>🏝️ Bar Island</strong><span class="pill">Code ${esc(state.code)}</span></div><div class="tabs">${tabs.map(t=>`<button class="tab ${state.tab===t[0]?'active':''}" onclick="setTab('${t[0]}')">${t[1]}</button>`).join('')}</div></div>`;
}
window.setTab=(t)=>{state.tab=t; renderGame();};
function me(){ return state.session?.players?.find(p=>p.id===state.playerId); }
function myCouple(){ const m=me(); return state.session?.couples?.find(c=>c.id===m?.coupleId); }
function renderGame(){
  const s=state.session; if(!s){ landing(); return; }
  app.innerHTML = nav() + `<section class="grid"><div>${mainPanel(s)}</div><div>${sidePanel(s)}</div></section>`;
}
function mainPanel(s){
  if(state.tab==='couples') return couplesPanel(s);
  if(state.tab==='challenge') return challengePanel(s);
  if(state.tab==='vote') return votePanel(s);
  if(state.tab==='recouple') return recouplePanel(s);
  return homePanel(s);
}
function homePanel(s){
  const m=me();
  return `<div class="card phase-banner"><div class="row between"><span class="pill tag">Round ${s.round}/5</span><span class="pill">${esc(s.status)}</span>${countdownPill(s)}</div><h1>${esc(s.title)}</h1><h2>${esc(s.currentPrompt)}</h2><p>${s.showtime?`Showtime: <b>${esc(s.showtime)}</b><br>`:''}${state.role==='player'&&m?`You are playing as <b>${esc(m.name)}</b>.`: 'You are voting as audience.'}</p></div>
  <div class="card"><h2>Game Flow</h2><div class="grid"><div class="profile"><b>1. Couple Up</b><span class="muted">The host forms the first couples.</span></div><div class="profile"><b>2. Challenges</b><span class="muted">Couples answer funny prompts.</span></div><div class="profile"><b>3. Vote</b><span class="muted">Players vote for other couples. Audience can vote for anyone.</span></div><div class="profile"><b>4. Recouple</b><span class="muted">Stay, switch, steal, or risk being single.</span></div><div class="profile"><b>5. Finale</b><span class="muted">Final vote crowns the champions.</span></div></div></div>
  ${m?`<div class="card"><h2>Your Profile</h2>${profile(m)}</div>`:''}`;
}
function sidePanel(s){
  return `<div class="card"><h2>Island Status</h2><div class="row"><span class="pill">Players ${s.players.length}/${s.maxPlayers}</span><span class="pill">Couples ${s.couples.length}</span><span class="pill">Audience ${s.audienceCount}</span></div>${leaderboard(s)}</div><div class="card"><h2>Current Answers</h2>${answers(s)}</div>`;
}
function profile(p){ return `<div class="profile ${p.status==='dumped'?'danger':''}"><div class="row between"><b>${esc(p.name)}</b><span class="pill ${p.status==='dumped'?'danger':'good'}">${esc(p.status)}</span></div><span>💚 ${esc(p.greenFlag||'No green flag yet')}</span><span>🚩 ${esc(p.redFlag||'No red flag yet')}</span><span>🧲 ${esc(p.type||'Mystery type')}</span><p>${esc(p.bio||p.pickup||'No profile answer yet.')}</p></div>`; }
function couplesPanel(s){
  if(!s.couples.length) return `<div class="card"><h1>No Couples Yet</h1><p>The host will start First Coupling soon.</p></div>`;
  return `<div class="card"><h1>Couples</h1><div class="grid">${s.couples.map(c=>`<div class="profile couple"><h3>${esc(c.players.map(p=>p.name).join(' + ')||'Single')}</h3>${c.players.map(profile).join('')}</div>`).join('')}</div></div>`;
}
function challengePanel(s){
  if(state.role!=='player') return `<div class="card"><h1>Audience</h1><p>Audience members vote, but do not submit couple answers.</p></div>`;
  const c=myCouple(); const active=['challenge1','challenge2','finale'].includes(s.phase);
  if(!c) return `<div class="card"><h1>Not Coupled Yet</h1><p>Wait for the host to form couples.</p></div>`;
  return `<div class="card"><h1>Couple Challenge</h1><p class="leader">${esc(s.currentPrompt)}</p><p>Your couple: <b>${esc(c.players.map(p=>p.name).join(' + '))}</b></p><form id="answerForm"><label>Submit your couple answer<textarea name="text" ${!active?'disabled':''} placeholder="Keep it funny and bar-friendly"></textarea></label><button ${!active?'disabled':''}>Submit Answer</button></form></div>`;
}
function votePanel(s){
  const active=['vote','finale','challenge1','challenge2'].includes(s.phase);
  const m=me();
  return `<div class="card"><h1>Vote</h1><p>${state.role==='player'?'Players can vote for other couples only.':'Audience voters can vote for any couple.'}</p>${s.couples.map(c=>{
    const own = state.role==='player' && m?.coupleId===c.id;
    return `<div class="vote-row profile"><div><b>${esc(c.players.map(p=>p.name).join(' + ')||'Single')}</b><br><span class="muted">${own?'Your couple — self vote blocked':'Eligible for vote'}</span></div><button ${(!active||own)?'disabled':''} onclick="vote('${c.id}')">Vote</button></div>`;
  }).join('')}</div>`;
}
function recouplePanel(s){
  if(state.role!=='player') return `<div class="card"><h1>Recoupling</h1><p>Audience can watch the drama, but only players submit recoupling choices.</p></div>`;
  const active=s.phase==='recoupling';
  const otherPlayers=s.players.filter(p=>p.id!==state.playerId && p.status!=='dumped');
  return `<div class="card"><h1>Recoupling</h1><p>Choose your move. The host sees all requests and announces the result.</p><form id="recoupleForm"><label>Your Move<select name="choice" ${!active?'disabled':''}><option value="stay">Stay loyal</option><option value="switch">Switch/steal someone</option><option value="single">Go single</option></select></label><label>Target Player<select name="targetPlayerId" ${!active?'disabled':''}><option value="">No target</option>${otherPlayers.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><button ${!active?'disabled':''}>Submit Recoupling Choice</button></form></div>`;
}
function leaderboard(s){
  if(!s.voteCounts?.length) return '<p>No votes yet.</p>';
  return `<h3>Vote Board</h3>${s.voteCounts.map((v,i)=>`<div class="row between profile"><span class="leader">${i+1}. ${esc(v.coupleName)}</span><span class="pill">${v.votes} votes</span></div>`).join('')}`;
}
function answers(s){
  if(!s.challengeAnswers?.length) return '<p>No answers revealed yet.</p>';
  return s.challengeAnswers.map(a=>`<div class="profile"><b>${esc(a.coupleName)}</b><p>${esc(a.text)}</p></div>`).join('');
}
window.vote=async(coupleId)=>{
  try{ const data=await api('/api/vote',{method:'POST',body:JSON.stringify({code:state.code,voterType:state.role,voterId:state.role==='player'?state.playerId:state.audienceId,coupleId})}); state.session=data.session; renderGame(); toast('Vote counted.'); }catch(e){ toast(e.message); }
};
document.addEventListener('submit', async ev=>{
  if(ev.target.id==='answerForm'){
    ev.preventDefault(); const text=new FormData(ev.target).get('text');
    try{ const data=await api('/api/answer',{method:'POST',body:JSON.stringify({code:state.code,playerId:state.playerId,text})}); state.session=data.session; renderGame(); toast('Answer submitted.'); }catch(e){ toast(e.message); }
  }
  if(ev.target.id==='recoupleForm'){
    ev.preventDefault(); const f=Object.fromEntries(new FormData(ev.target).entries());
    try{ const data=await api('/api/recouple',{method:'POST',body:JSON.stringify({code:state.code,playerId:state.playerId,...f})}); state.session=data.session; renderGame(); toast('Recoupling choice submitted.'); }catch(e){ toast(e.message); }
  }
});
if(state.code && (state.playerId || state.audienceId)){ refresh(false); startPolling(); } else landing();
