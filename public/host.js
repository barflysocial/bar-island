const $ = (s,r=document)=>r.querySelector(s);
const app=$('#hostApp');
const state={ sessions:[], selected:null, timer:null };
function esc(v=''){return String(v).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));}
async function api(url, opts={}){const res=await fetch(url,{headers:{'Content-Type':'application/json'},...opts});const data=await res.json().catch(()=>({}));if(!res.ok)throw new Error(data.error||'Request failed.');return data;}
function toast(msg){const el=document.createElement('div');el.className='toast';el.textContent=msg;document.body.appendChild(el);setTimeout(()=>el.remove(),2600);}
async function load(){const data=await api('/api/sessions');state.sessions=data.sessions;if(state.selected){const found=state.sessions.find(s=>s.id===state.selected.id);state.selected=found||state.sessions[0]||null;}render();}
function startPolling(){clearInterval(state.timer);state.timer=setInterval(load,4000)}
function render(){
 app.innerHTML=`<div class="nav"><div class="row between"><strong>🏝️ Bar Island Host</strong><a class="button secondary" href="/">Player View</a></div></div><section class="grid"><div>${sessionList()}</div><div>${hostPanel()}</div></section>`;
}
function sessionList(){
 return `<div class="card"><h1>Host Dashboard</h1><form id="createForm" class="grid"><label>Game Title<input name="title" value="Bar Island: Coupled Up"></label><label>Showtime<input name="showtime" placeholder="Tonight 8:00 PM"></label><label>Runtime Minutes<input name="runtimeMinutes" type="number" value="45"></label><label>Max Players<input name="maxPlayers" type="number" value="12"></label><button>Create Session</button></form></div><div class="card"><h2>Sessions</h2>${state.sessions.length?state.sessions.map(s=>`<button class="secondary" style="width:100%;margin:5px 0;justify-content:space-between" onclick="selectSession('${s.id}')"><span>${esc(s.title)}</span><span class="pill">${esc(s.code)}</span></button>`).join(''):'<p>No sessions yet.</p>'}</div>`;
}
function hostPanel(){
 const s=state.selected||state.sessions[0]; if(!s)return `<div class="card"><h1>Create a session to begin.</h1></div>`; state.selected=s;
 return `<div class="card phase-banner"><div class="row between"><div><h1>${esc(s.title)}</h1><div class="big-code">${esc(s.code)}</div></div><div><span class="pill">${esc(s.phase)}</span><span class="pill">Round ${s.round}/5</span></div></div><p>${esc(s.currentPrompt)}</p><div class="row"><button onclick="copyCode('${s.code}')">Copy Code</button><button class="danger" onclick="deleteSession('${s.id}')">Delete</button></div></div>
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
function recoupling(s){const req=s.recouplingRequests||{};const items=Object.values(req);return items.length?items.map(r=>{const target=s.players.find(p=>p.id===r.targetPlayerId);return `<div class="profile"><b>${esc(r.playerName)}</b><span>${esc(r.choice)}</span><span class="muted">Target: ${esc(target?.name||'None')}</span></div>`}).join(''):'<p>No recoupling choices yet.</p>'}
window.selectSession=(id)=>{state.selected=state.sessions.find(s=>s.id===id);render();}
window.copyCode=async(c)=>{await navigator.clipboard.writeText(c).catch(()=>{});toast('Code copied.');}
window.setPhase=async(phase)=>{if(!state.selected)return; if(!confirm(`Move game to ${phase}?`))return; try{const data=await api(`/api/host/${state.selected.id}/phase`,{method:'POST',body:JSON.stringify({phase})});state.selected=data.session;await load();toast('Phase updated.');}catch(e){toast(e.message)}}
window.autoPair=async(id)=>{if(!confirm('Auto pair active players?'))return;try{const data=await api(`/api/host/${id}/pair`,{method:'POST'});state.selected=data.session;await load();toast('Players paired.');}catch(e){toast(e.message)}}
window.dumpCouple=async(coupleId)=>{if(!state.selected||!confirm('Dump this couple from Bar Island?'))return;try{const data=await api(`/api/host/${state.selected.id}/dump`,{method:'POST',body:JSON.stringify({coupleId})});state.selected=data.session;await load();toast('Couple dumped.');}catch(e){toast(e.message)}}
window.deleteSession=async(id)=>{if(!confirm('Delete this entire session?'))return;try{await api(`/api/host/${id}/delete`,{method:'POST'});state.selected=null;await load();toast('Session deleted.');}catch(e){toast(e.message)}}
document.addEventListener('submit',async ev=>{if(ev.target.id==='createForm'){ev.preventDefault();const f=Object.fromEntries(new FormData(ev.target).entries());try{const data=await api('/api/sessions',{method:'POST',body:JSON.stringify(f)});state.selected=data.session;await load();toast('Session created.');}catch(e){toast(e.message)}}});
load();startPolling();
