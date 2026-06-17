const $ = (s,r=document)=>r.querySelector(s);
const app=$('#hostApp');
const state={ sessions:[], selected:null, timer:null, unlocked: localStorage.barIslandHostUnlocked === 'yes', hostPin: localStorage.barIslandHostPin || '', activeGameId: localStorage.barIslandActiveGameId || '' };
function esc(v=''){return String(v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}
async function api(url, opts={}){
  const res=await fetch(url,{headers:{'Content-Type':'application/json','X-Host-Pin':state.hostPin},...opts});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||'Request failed.');
  return data;
}
function toast(msg){const el=document.createElement('div');el.className='toast';el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.remove(),2600);}
function renderLocked(){
  app.innerHTML=`<section class="screen host-login"><div class="card center"><h1>Host Dashboard</h1><p>Enter the Host PIN to unlock Bar Island controls.</p><form id="pinForm" class="grid one"><label>Host PIN<input name="pin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Enter PIN" autofocus required></label><button>Unlock Host Dashboard</button></form><p class="small muted">Player-facing screens do not show the host dashboard.</p></div></section>`;
}
async function unlock(pin){
  const res=await fetch('/api/host/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin})});
  const data=await res.json().catch(()=>({}));
  if(!res.ok) throw new Error(data.error||'Incorrect PIN. Try again.');
  state.hostPin=pin; state.unlocked=true; localStorage.barIslandHostPin=pin; localStorage.barIslandHostUnlocked='yes';
  await load(); startPolling();
}
async function load(){
  if(!state.unlocked){ renderLocked(); return; }
  const data=await api('/api/sessions');
  state.sessions=data.sessions;
  const preferredId = state.selected?.id || state.activeGameId || localStorage.barIslandActiveGameId || '';
  if(preferredId){ const found=state.sessions.find(s=>s.id===preferredId); state.selected=found||state.sessions[0]||null; }
  else state.selected=state.sessions.find(s=>s.status==='live') || state.sessions[0] || null;
  if(state.selected){ state.activeGameId=state.selected.id; localStorage.barIslandActiveGameId=state.selected.id; }
  render();
}
function startPolling(){clearInterval(state.timer);state.timer=setInterval(load,4000)}
function statusPill(s){ return `<span class="pill ${s.status==='live'?'good':s.status==='completed'?'danger':''}">${esc(s.status)}</span>`; }
function fmt(s){ return s.showtime || (s.scheduledAt ? new Date(s.scheduledAt).toLocaleString() : 'No date set'); }
function countdown(s){
  if(!s.scheduledAt || s.status==='live' || s.status==='completed') return '';
  const diff = new Date(s.scheduledAt).getTime() - Date.now();
  if(diff<=0) return '<span class="pill good">Ready by server time</span>';
  const mins=Math.floor(diff/60000), hrs=Math.floor(mins/60), days=Math.floor(hrs/24);
  const text = days>0 ? `${days}d ${hrs%24}h` : hrs>0 ? `${hrs}h ${mins%60}m` : `${Math.max(0,mins)}m`;
  return `<span class="pill">Starts in ${text}</span>`;
}
function render(){
 app.innerHTML=`<div class="nav"><div class="row between"><strong>🏝️ Bar Island Host</strong><div class="row"><span class="pill">PIN unlocked</span><button class="secondary" onclick="lockHost()">Lock</button></div></div></div><section class="grid"><div>${sessionList()}</div><div>${hostPanel()}</div></section>`;
}
function today(){ return new Date().toISOString().slice(0,10); }
function sessionList(){
 return `<div class="card"><h1>Create Game</h1><p>Create each Bar Island game by calendar date and start time. The countdown uses server time.</p><form id="createForm" class="grid"><label>Game Title<input name="title" value="Bar Island"></label><label>Calendar Date<input name="calendarDate" type="date" value="${today()}" required></label><label>Start Time<input name="startTime" type="time" required></label><label>Runtime Minutes<input name="runtimeMinutes" type="number" value="45"></label><label>Max Players<input name="maxPlayers" type="number" value="12"></label><button>Create Scheduled Game</button></form></div><div class="card"><h2>Scheduled Games</h2>${state.sessions.length?state.sessions.map(s=>`<button class="secondary session-btn" onclick="selectSession('${s.id}')"><span><b>${esc(s.title)}</b><br><small>${esc(fmt(s))}</small></span><span>${statusPill(s)}<span class="pill">${esc(s.code)}</span></span></button>`).join(''):'<p>No games yet.</p>'}</div>`;
}
function hostPanel(){
 const s=state.selected; if(!s)return `<div class="card"><h1>Create a scheduled game to begin.</h1></div>`;
 return `<div class="card phase-banner"><div class="row between"><div><h1>${esc(s.title)}</h1><div class="big-code">${esc(s.code)}</div><p>${esc(fmt(s))}</p></div><div class="row"><span class="pill">Round ${s.round}/5</span>${statusPill(s)}${countdown(s)}</div></div><p>${esc(s.currentPrompt)}</p><div class="row"><button onclick="copyCode('${s.code}')">Copy Code</button><button class="teal" onclick="openPublic('${s.code}')">Open Public Display</button><button class="danger" onclick="deleteSession('${s.id}')">Delete</button></div></div>
 <div class="card"><h2>Round Controls</h2><div class="grid">${phaseButton('firstCoupling','1. First Coupling / Auto Pair')}${phaseButton('challenge1','2. Challenge 1')}${phaseButton('challenge2','3. Challenge 2')}${phaseButton('vote','4. Audience Vote')}${phaseButton('recoupling','4B. Recoupling')}${phaseButton('finale','5. Finale')}${phaseButton('ended','End + Crown Winner')}</div></div>
 <div class="desktop-two"><div>${players(s)}</div><div>${couples(s)}</div></div>
 <div class="desktop-two"><div>${answers(s)}</div><div>${votes(s)}</div></div>
 <div class="card"><h2>Recoupling Requests</h2>${recoupling(s)}</div>`;
}
function phaseButton(phase,label){return `<button class="secondary" onclick="setPhase('${phase}')">${label}</button>`;}
function players(s){return `<div class="card"><h2>Players ${s.players.length}/${s.maxPlayers}</h2>${s.players.length?s.players.map(p=>`<div class="profile ${p.status==='dumped'?'danger':''}"><div class="row between"><b>${esc(p.name)}</b><span class="pill">${esc(p.status)}</span></div><span class="muted">${esc(p.type||'')}</span><span>💚 ${esc(p.greenFlag||'')}</span><span>🚩 ${esc(p.redFlag||'')}</span></div>`).join(''):'<p>No players yet.</p>'}</div>`}
function couples(s){return `<div class="card"><h2>Couples ${s.couples.length}</h2><button class="teal" onclick="autoPair('${s.id}')">Auto Pair / Repair</button>${s.couples.length?s.couples.map(c=>`<div class="profile couple"><div class="row between"><b>${esc(c.players.map(p=>p.name).join(' + ')||'Single')}</b><button class="danger" onclick="dumpCouple('${c.id}')">Dump</button></div></div>`).join(''):'<p>No couples yet.</p>'}</div>`}
function answers(s){return `<div class="card"><h2>Challenge Answers</h2>${s.challengeAnswers?.length?s.challengeAnswers.map(a=>`<div class="profile"><b>${esc(a.coupleName)}</b><p>${esc(a.text)}</p></div>`).join(''):'<p>No answers yet.</p>'}</div>`}
function votes(s){return `<div class="card"><h2>Vote Board</h2>${s.voteCounts?.length?s.voteCounts.map((v,i)=>`<div class="profile row between"><b>${i+1}. ${esc(v.coupleName)}</b><span class="pill">${v.votes} votes</span></div>`).join(''):'<p>No votes yet.</p>'}</div>`}
function recoupling(s){const items=Object.values(s.recouplingRequests||{});return items.length?items.map(r=>{const target=s.players.find(p=>p.id===r.targetPlayerId);return `<div class="profile"><b>${esc(r.playerName)}</b><span>${esc(r.choice)}</span><span class="muted">Target: ${esc(target?.name||'None')}</span></div>`}).join(''):'<p>No recoupling choices yet.</p>'}
window.selectSession=(id)=>{state.selected=state.sessions.find(s=>s.id===id); if(state.selected){state.activeGameId=id; localStorage.barIslandActiveGameId=id;} render();}
window.copyCode=async(c)=>{await navigator.clipboard.writeText(c).catch(()=>{});toast('Code copied.');}
window.openPublic=(code)=>{ window.open(`/public?code=${encodeURIComponent(code)}`, '_blank'); }
window.lockHost=()=>{localStorage.removeItem('barIslandHostUnlocked');localStorage.removeItem('barIslandHostPin');state.unlocked=false;state.hostPin='';clearInterval(state.timer);renderLocked();}
window.setPhase=async(phase)=>{if(!state.selected)return; if(!confirm(`Move game to ${phase}?`))return; try{const data=await api(`/api/host/${state.selected.id}/phase`,{method:'POST',body:JSON.stringify({phase})});state.selected=data.session;await load();toast('Phase updated.');}catch(e){toast(e.message)}}
window.autoPair=async(id)=>{if(!confirm('Auto pair active players?'))return;try{const data=await api(`/api/host/${id}/pair`,{method:'POST'});state.selected=data.session;await load();toast('Players paired.');}catch(e){toast(e.message)}}
window.dumpCouple=async(coupleId)=>{if(!state.selected||!confirm('Dump this couple from Bar Island?'))return;try{const data=await api(`/api/host/${state.selected.id}/dump`,{method:'POST',body:JSON.stringify({coupleId})});state.selected=data.session;await load();toast('Couple dumped.');}catch(e){toast(e.message)}}
window.deleteSession=async(id)=>{if(!confirm('Delete this entire session?'))return;try{await api(`/api/host/${id}/delete`,{method:'POST'});state.selected=null;await load();toast('Session deleted.');}catch(e){toast(e.message)}}
document.addEventListener('submit',async ev=>{
  if(ev.target.id==='pinForm'){
    ev.preventDefault(); const pin=new FormData(ev.target).get('pin');
    try{ await unlock(pin); toast('Host dashboard unlocked.'); }catch(e){toast(e.message)}
  }
  if(ev.target.id==='createForm'){
    ev.preventDefault(); const f=Object.fromEntries(new FormData(ev.target).entries());
    if(f.calendarDate && f.startTime) f.scheduledAt = new Date(`${f.calendarDate}T${f.startTime}:00`).toISOString();
    try{const data=await api('/api/sessions',{method:'POST',body:JSON.stringify(f)});state.selected=data.session; state.activeGameId=data.session.id; localStorage.barIslandActiveGameId=data.session.id; await load();toast('Scheduled game created.');}catch(e){toast(e.message)}
  }
});
if(state.unlocked){ load(); startPolling(); } else renderLocked();
