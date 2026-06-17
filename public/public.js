const $ = (s,r=document)=>r.querySelector(s);
const app = $('#publicApp');
const params = new URLSearchParams(location.search);
const state = { code: (params.get('code') || localStorage.barIslandPublicCode || '').toUpperCase(), session:null, sessions:[], timer:null };
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
async function api(url){const res=await fetch(url); const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error||'Request failed.'); return data;}
function joinUrl(s){return `${location.origin}/?code=${encodeURIComponent(s.code)}`;}
function qrUrl(s){return `/api/qr.svg?text=${encodeURIComponent(joinUrl(s))}`;}
function fmtTime(s){return s.showtime || (s.scheduledAt ? new Date(s.scheduledAt).toLocaleString() : 'No showtime set');}
function statusPill(s){return `<span class="pill ${s.status==='live'?'good':s.status==='completed'?'danger':''}">${esc(s.status)}</span>`;}
function countdown(s){
  if(!s.scheduledAt || s.status==='live') return s.status==='live' ? '<span class="pill good">LIVE NOW</span>' : '';
  if(s.status==='completed') return '<span class="pill danger">COMPLETED</span>';
  const serverMs = s.serverTime ? new Date(s.serverTime).getTime() : Date.now();
  const diff = new Date(s.scheduledAt).getTime() - serverMs;
  if(diff<=0) return '<span class="pill good">READY BY SERVER TIME</span>';
  const total=Math.floor(diff/1000), days=Math.floor(total/86400), hrs=Math.floor((total%86400)/3600), mins=Math.floor((total%3600)/60), secs=total%60;
  const text = days>0 ? `${days}d ${hrs}h ${mins}m` : hrs>0 ? `${hrs}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;
  return `<span class="pill">Starts in ${text}</span>`;
}
async function loadSessions(){const data=await api('/api/sessions'); state.sessions=data.sessions||[];}
async function refresh(){
  if(!state.code){ await loadSessions(); renderPicker(); return; }
  try{ const data=await api(`/api/session/${encodeURIComponent(state.code)}`); state.session=data.session; localStorage.barIslandPublicCode=state.code; render(); }
  catch(e){ await loadSessions(); renderPicker(e.message); }
}
function start(){clearInterval(state.timer); state.timer=setInterval(refresh,2500);}
function renderPicker(msg=''){
  app.innerHTML = `<section class="public-display"><div class="public-title"><img class="public-logo" src="/assets/bar-island-title.png" alt="Bar Island"><div><h1>Public Display</h1><p>Choose the scheduled game to show on the TV/projector.</p>${msg?`<p class="danger pill">${esc(msg)}</p>`:''}</div></div><div class="card"><h2>Scheduled Games</h2>${state.sessions.filter(s=>s.status!=='completed').length?state.sessions.filter(s=>s.status!=='completed').map(s=>`<button class="secondary session-choice" onclick="choosePublic('${esc(s.code)}')"><span><b>${esc(s.title)}</b><br><small>${esc(fmtTime(s))}</small></span><span><span class="pill">${esc(s.code)}</span>${statusPill(s)}</span></button>`).join(''):'<p>No scheduled games yet.</p>'}</div></section>`;
}
window.choosePublic=(code)=>{state.code=code.toUpperCase(); localStorage.barIslandPublicCode=state.code; const url=new URL(location.href); url.searchParams.set('code', state.code); history.replaceState(null,'',url); refresh(); start();}
function render(){
  const s=state.session; if(!s){ renderPicker(); return; }
  const couples = s.couples || [];
  const votes = s.voteCounts || [];
  const top = votes[0];
  const answers = s.challengeAnswers || [];
  const winner = s.winner || (s.status==='completed' ? top : null);
  app.innerHTML = `<section class="public-display">
    <div class="public-title card">
      <img class="public-logo" src="/assets/bar-island-title.png" alt="Bar Island">
      <div class="public-headline"><div class="row"><span class="pill tag">Round ${esc(s.round)}/5</span>${statusPill(s)}${countdown(s)}</div><h1>${esc(s.title)}</h1><div class="big-code">${esc(s.code)}</div><p>${esc(fmtTime(s))}</p></div>
      <div class="qr-card"><img src="${qrUrl(s)}" alt="Join QR"><b>Scan to Join/Vote</b><span>${esc(joinUrl(s))}</span></div>
    </div>
    ${winner?`<div class="winner-card card"><h1>🏆 Bar Island Champions</h1><div class="winner-name">${esc(winner.coupleName||'Winning Couple')}</div><p>${winner.votes ?? 0} votes</p></div>`:''}
    <div class="public-grid">
      <div class="card"><h2>Current Round</h2><p class="leader">${esc(s.currentPrompt)}</p><div class="row"><span class="pill">Players ${s.players.length}/${s.maxPlayers}</span><span class="pill">Couples ${couples.length}</span><span class="pill">Audience ${s.audienceCount}</span></div></div>
      <div class="card"><h2>Vote Board</h2>${votes.length?votes.map((v,i)=>`<div class="public-row"><b>${i+1}. ${esc(v.coupleName)}</b><span class="pill">${v.votes} votes</span></div>`).join(''):'<p>No votes yet.</p>'}</div>
    </div>
    <div class="public-grid">
      <div class="card"><h2>Couples</h2>${couples.length?couples.map(c=>`<div class="public-row couple"><b>${esc(c.players.map(p=>p.name).join(' + ')||'Single')}</b><span class="pill">${c.players.length} islander${c.players.length===1?'':'s'}</span></div>`).join(''):'<p>No couples yet. Waiting on the host to pair players.</p>'}</div>
      <div class="card"><h2>Challenge Answers</h2>${answers.length?answers.map(a=>`<div class="profile"><b>${esc(a.coupleName)}</b><p>${esc(a.text)}</p></div>`).join(''):'<p>Answers will appear here when submitted/revealed.</p>'}</div>
    </div>
    <div class="card"><h2>Recoupling Watch</h2>${Object.keys(s.recouplingRequests||{}).length?Object.values(s.recouplingRequests).map(r=>`<span class="pill">${esc(r.playerName)}: ${esc(r.choice)}</span>`).join(' '):'<p>No recoupling requests yet.</p>'}</div>
  </section>`;
}
refresh(); start();
