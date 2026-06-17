const $ = (s, r=document) => r.querySelector(s);
const app = $('#app');
const state = {
  code: localStorage.barIslandCode || '',
  playerId: localStorage.barIslandPlayerId || '',
  audienceId: localStorage.barIslandAudienceId || '',
  role: localStorage.barIslandRole || 'player',
  session: null,
  tab: 'home',
  timer: null
};
const phases = ['checkin','firstCoupling','challenge1','challenge2','vote','recoupling','finale','ended'];
function esc(v=''){ return String(v).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m])); }
async function api(url, opts={}){
  const res = await fetch(url, { headers:{'Content-Type':'application/json'}, ...opts });
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function toast(msg){ const el=document.createElement('div'); el.className='toast'; el.textContent=msg; document.body.appendChild(el); setTimeout(()=>el.remove(),2600); }
function saveLocal(){ localStorage.barIslandCode=state.code||''; localStorage.barIslandPlayerId=state.playerId||''; localStorage.barIslandAudienceId=state.audienceId||''; localStorage.barIslandRole=state.role||'player'; }
async function refresh(silent=true){
  if(!state.code) return;
  try{
    const id = state.role === 'player' ? state.playerId : state.audienceId;
    const data = await api(`/api/session/${encodeURIComponent(state.code)}?viewerId=${encodeURIComponent(id||'')}`);
    state.session=data.session; renderGame();
  }catch(e){ if(!silent) toast(e.message); }
}
function startPolling(){ clearInterval(state.timer); state.timer=setInterval(()=>refresh(true),3500); }
function landing(){
  app.innerHTML = `<section class="screen"><div class="hero"><img class="title-img" src="/assets/bar-island-title.png" alt="Bar Island title graphic"><div class="card glass"><h1 class="brand">Bar Island</h1><h2 class="script">A Social Bar Game</h2><p>Couple up, compete in funny bar challenges, survive recouplings, and let the crowd choose the champions.</p><div class="grid"><button onclick="showJoin('player')">Join as Player</button><button class="teal" onclick="showJoin('audience')">Join Audience Vote</button><a class="button secondary" href="/host">Host Dashboard</a></div><p class="small">Players cannot vote for themselves or their own couple. Audience voters can vote for anyone.</p></div></div></section>`;
}
window.showJoin = (role) => {
  state.role = role; saveLocal();
  app.innerHTML = `<section class="screen"><div class="card"><h1>${role==='player'?'Join Bar Island':'Audience Vote'}</h1><p>${role==='player'?'Create your islander profile.':'Join the crowd vote and help decide who survives.'}</p><form id="joinForm" class="grid">
    <label>Session Code<input name="code" value="${esc(state.code)}" placeholder="ABC123" required></label>
    <label>Your Name<input name="name" placeholder="Nickname" required></label>
    ${role==='player'?`<label>Phone <input name="phone" placeholder="Used for re-entry"></label><label>Type on Paper<input name="type" placeholder="Funny, loyal, chaotic, mysterious..."></label><label>Green Flag<input name="greenFlag" placeholder="What makes you dateable?"></label><label>Red Flag<input name="redFlag" placeholder="Keep it playful"></label><label>Best Pickup Line<textarea name="pickup" placeholder="Your best clean pickup line"></textarea></label><label>Bio<textarea name="bio" placeholder="One sentence about your islander energy"></textarea></label>`:''}
    <div class="row"><button type="submit">Enter Island</button><button type="button" class="secondary" onclick="landing()">Back</button></div>
  </form></div></section>`;
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
  return `<div class="card phase-banner"><div class="row between"><span class="pill tag">Round ${s.round}/5</span><span class="pill">${esc(s.phase)}</span></div><h1>${esc(s.title)}</h1><h2>${esc(s.currentPrompt)}</h2><p>${state.role==='player'&&m?`You are playing as <b>${esc(m.name)}</b>.`: 'You are voting as audience.'}</p></div>
  <div class="card"><h2>How Bar Island Works</h2><div class="grid"><div class="profile"><b>1. Couple Up</b><span class="muted">The host forms the first couples.</span></div><div class="profile"><b>2. Challenges</b><span class="muted">Couples answer funny prompts.</span></div><div class="profile"><b>3. Vote</b><span class="muted">Players vote for other couples. Audience can vote for anyone.</span></div><div class="profile"><b>4. Recouple</b><span class="muted">Stay, switch, steal, or risk being single.</span></div><div class="profile"><b>5. Finale</b><span class="muted">Final vote crowns the champions.</span></div></div></div>
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
  const m=me(); const c=myCouple(); const active=['challenge1','challenge2','finale'].includes(s.phase);
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
