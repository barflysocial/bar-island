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
  tab: 'home',
  session: null,
  sessions: [],
  timer: null,
  clockTimer: null,
  serverOffset: 0
};
function esc(v=''){ return String(v ?? '').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function saveLocal(){ localStorage.barIslandCode=state.code||''; localStorage.barIslandRole=state.role||'player'; if(state.playerId) localStorage.barIslandPlayerId=state.playerId; if(state.audienceId) localStorage.barIslandAudienceId=state.audienceId; }
async function api(url, opts={}){ const res=await fetch(url,{headers:{'Content-Type':'application/json'},...opts}); const data=await res.json().catch(()=>({})); if(!res.ok) throw new Error(data.error || 'Request failed.'); return data; }
function toast(msg){ const el=document.createElement('div'); el.className='toast'; el.textContent=msg; document.body.appendChild(el); setTimeout(()=>el.remove(),2600); }
function syncClock(serverTime){ if(serverTime) state.serverOffset = Date.parse(serverTime) - Date.now(); }
function serverNowMs(){ return Date.now() + state.serverOffset; }
function fmtDuration(ms){ const total=Math.max(0,Math.ceil(ms/1000)); const m=String(Math.floor(total/60)).padStart(2,'0'); const s=String(total%60).padStart(2,'0'); return `${m}:${s}`; }
function liveClock(){ return new Date(serverNowMs()).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',second:'2-digit'}); }
function countdownText(targetIso){ if(!targetIso) return ''; return fmtDuration(Date.parse(targetIso) - serverNowMs()); }
function countdownPill(s){
  if(s.currentQuestion?.endsAt) return `<span class="pill timer-pill">Question ${countdownText(s.currentQuestion.endsAt)}</span>`;
  if(s.currentMingle?.endsAt) return `<span class="pill timer-pill">Mingle ${countdownText(s.currentMingle.endsAt)}</span>`;
  if(s.scheduledAt && ['upcoming','waiting'].includes(s.status)){ const diff=Date.parse(s.scheduledAt)-serverNowMs(); if(diff>0) return `<span class="pill">Starts in ${fmtDuration(diff)}</span>`; return `<span class="pill good">Ready by server time</span>`; }
  return '';
}
function refreshClockBadges(){ document.querySelectorAll('[data-countdown-target]').forEach(el=>{ el.textContent=countdownText(el.dataset.countdownTarget); }); document.querySelectorAll('[data-server-clock]').forEach(el=>{ el.textContent=liveClock(); }); }
function startClock(){ clearInterval(state.clockTimer); state.clockTimer=setInterval(refreshClockBadges,1000); }
async function loadSessions(){ try{ const data=await api('/api/sessions'); syncClock(data.serverTime); state.sessions=data.sessions||[]; }catch{} }
async function refresh(render=true){ if(!state.code) return; try{ const viewerId=state.role==='player'?state.playerId:state.audienceId; const data=await api(`/api/session/${encodeURIComponent(state.code)}?viewerId=${encodeURIComponent(viewerId||'')}`); state.session=data.session; syncClock(data.session.serverTime); if(render) renderGame(); }catch(e){ if(render) toast(e.message); } }
function startPolling(){ clearInterval(state.timer); state.timer=setInterval(()=>refresh(true),3000); startClock(); }
function sessionOptions(){ if(!state.sessions.length) return '<p>No scheduled games yet. Ask the host for the session code.</p>'; return state.sessions.map(s=>`<button type="button" class="secondary session-choice" onclick="chooseSession('${esc(s.code)}')"><span><b>${esc(s.title)}</b><br><small>${esc(s.showtime||'No time set')}</small></span><span><span class="pill">${esc(s.code)}</span><span class="pill">${s.players.length}/${s.maxPlayers}</span></span></button>`).join(''); }
window.chooseSession=(code)=>{ const input=$('input[name="code"]'); if(input) input.value=code; state.code=code; saveLocal(); };
function landing(){
  state.session=null;
  app.innerHTML = `<section class="screen title-only"><div class="hero solo"><img class="title-img" src="/assets/bar-island-title.png" alt="Bar Island"><div class="home-buttons"><button onclick="showJoin('player')">Join Player</button><button onclick="showJoin('audience')">Join Audience Vote</button><button class="secondary" onclick="howToPlay()">How to Play</button><button class="secondary" onclick="shareGame()">Share</button></div></div></section>`;
}
window.howToPlay=()=>{ app.innerHTML=`<section class="screen"><div class="card"><h1>How to Play</h1><p>Join the island, create a profile, couple up, answer timed questions, vote for other couples, survive recoupling, and try to become Bar Island Champions.</p><div class="grid"><div class="profile"><b>Questions</b><span>Most prompts are quick multiple choice. Finale and crowd moments use typed answers.</span></div><div class="profile"><b>Timers</b><span>Question timers use server time, so every phone sees the same countdown.</span></div><div class="profile"><b>Voting</b><span>Players cannot vote for themselves or their own couple. Audience voters can vote for anyone.</span></div></div><div class="row"><button onclick="landing()">Back</button></div></div></section>`; };
window.shareGame=async()=>{ const data={title:'Bar Island',text:'Join Bar Island.',url:state.code?`${location.origin}/?code=${encodeURIComponent(state.code)}`:location.origin}; if(navigator.share){try{await navigator.share(data);return;}catch{}} await navigator.clipboard.writeText(data.url).catch(()=>{}); toast('Share link copied.'); };
window.showJoin=async(role)=>{
  state.role=role; saveLocal(); await loadSessions();
  app.innerHTML=`<section class="screen"><div class="card"><h1>${role==='player'?'Join Player':'Join Audience Vote'}</h1><form id="joinForm" class="grid">
    <label>Session Code<input name="code" value="${esc(state.code)}" placeholder="ABC123" required></label>
    <label>Your Name<input name="name" placeholder="Nickname" required></label>
    ${role==='player'?`<label>Phone <input name="phone" placeholder="Used for re-entry"></label><label>My Type<input name="type" placeholder="Funny, loyal, chaotic, mysterious..."></label><label>Green Flag<input name="greenFlag" placeholder="What makes you dateable?"></label><label>Red Flag<input name="redFlag" placeholder="Keep it playful"></label><label>Best Pickup Line<textarea name="pickup" placeholder="Your best clean pickup line"></textarea></label><label>Bio<textarea name="bio" placeholder="One sentence about your islander energy"></textarea></label>`:''}
    <div class="row"><button type="submit">Enter Island</button><button type="button" class="secondary" onclick="landing()">Back</button></div>
  </form></div><div class="card"><h2>Scheduled Games</h2>${sessionOptions()}</div></section>`;
  $('#joinForm').onsubmit=async(ev)=>{ ev.preventDefault(); const f=Object.fromEntries(new FormData(ev.target).entries()); state.code=f.code.toUpperCase().trim(); try{ if(role==='player'){ const data=await api('/api/join',{method:'POST',body:JSON.stringify(f)}); state.playerId=data.player.id; state.session=data.session; syncClock(data.session.serverTime); } else { const data=await api('/api/audience',{method:'POST',body:JSON.stringify(f)}); state.audienceId=data.audience.id; state.session=data.session; syncClock(data.session.serverTime); } saveLocal(); renderGame(); startPolling(); }catch(e){toast(e.message);} };
};
function phaseLabel(s){
  const labels={checkin:'Waiting Room',firstCoupling:'Couple Reveal',mingle:'Mingle Time',challenge1:'Challenge Round 1',challenge2:'Challenge Round 2',vote:'Audience Vote',recoupling:'Recoupling',finale:'Finale Pitch',ended:'Winner Reveal'};
  return labels[s.phase] || 'Bar Island';
}
function nextStep(s){
  const next={checkin:'Next: first coupling',firstCoupling:'Next: couple mingle',mingle:'Next: Challenge Round 1',challenge1:'Next: reveal or voting',challenge2:'Next: audience vote',vote:'Next: recoupling',recoupling:'Next: finale',finale:'Next: winner reveal',ended:'Game complete'};
  return next[s.phase] || 'Wait for the host';
}
function statusStrip(s){
  const timer = s.currentQuestion?.endsAt ? ` · <span data-countdown-target="${esc(s.currentQuestion.endsAt)}">${countdownText(s.currentQuestion.endsAt)}</span>` : (s.currentMingle?.endsAt ? ` · <span data-countdown-target="${esc(s.currentMingle.endsAt)}">${countdownText(s.currentMingle.endsAt)}</span>` : '');
  return `<div class="player-strip"><span>🏝️ Bar Island</span><span>Round ${s.round}/5</span><span>${esc(phaseLabel(s))}${timer}</span></div>`;
}
function renderGame(){
  const s=state.session;
  if(!s){ landing(); return; }
  syncClock(s.serverTime);
  if(state.role==='player') app.innerHTML = `<section class="screen player-flow">${statusStrip(s)}${playerPhasePanel(s)}</section>`;
  else app.innerHTML = `<section class="screen player-flow">${statusStrip(s)}${audiencePhasePanel(s)}</section>`;
  refreshClockBadges();
}
function playerPhasePanel(s){
  const m=me();
  const c=myCouple();
  const q=s.currentQuestion;
  if(s.phase==='ended' || s.status==='completed') return winnerPanel(s);
  if(s.phase==='checkin') return `<div class="card guided-card"><h1>You're Checked In</h1><p>Playing as <b>${esc(m?.name||'Islander')}</b>.</p><p class="muted">The host will start first coupling when everyone is ready.</p><div class="next-step">${nextStep(s)}</div></div>`;
  if(s.phase==='firstCoupling') return `<div class="card guided-card"><h1>Couple Reveal</h1><p>The host is forming the first couples.</p><p class="muted">Watch the public screen and get ready to meet your partner.</p><div class="next-step">${nextStep(s)}</div></div>`;
  if(s.phase==='mingle') return minglePanel(s) + `<div class="card guided-card compact"><div class="next-step">${nextStep(s)}</div></div>`;
  if(q && ['challenge1','challenge2','vote','finale'].includes(s.phase)) return challengePanel(s);
  if(['challenge1','challenge2','finale'].includes(s.phase)) return `<div class="card guided-card"><h1>Waiting for the Question</h1><p>The host is about to start the next prompt.</p><div class="next-step">${nextStep(s)}</div></div>`;
  if(s.phase==='vote') return votePanel(s);
  if(s.phase==='recoupling') return recouplePanel(s);
  return `<div class="card guided-card"><h1>${esc(phaseLabel(s))}</h1><p>${esc(s.currentPrompt||'Wait for the host to continue.')}</p><div class="next-step">${nextStep(s)}</div></div>`;
}
function audiencePhasePanel(s){
  if(s.phase==='ended' || s.status==='completed') return winnerPanel(s);
  if(['vote','finale','challenge1','challenge2'].includes(s.phase)) return votePanel(s);
  return `<div class="card guided-card"><h1>${esc(phaseLabel(s))}</h1><p>You are in audience vote mode.</p><p class="muted">Voting opens when the host starts a voting moment.</p><div class="next-step">${nextStep(s)}</div></div><div class="card"><h2>Current Couples</h2>${couplesListMini(s)}</div>`;
}
function couplesListMini(s){
  if(!s.couples?.length) return '<p>No couples yet.</p>';
  return s.couples.map(c=>`<div class="profile couple"><b>${esc(c.players.map(p=>p.name).join(' + ')||'Single')}</b></div>`).join('');
}
function me(){
  return (state.session?.players || []).find(p => p.id === state.playerId) || null;
}
function myCouple(){
  const player = me();
  if(!player) return null;
  return (state.session?.couples || []).find(c => c.id === player.coupleId || (c.players || []).some(p => p.id === player.id)) || null;
}
function myAnswer(){
  const s = state.session;
  const q = s?.currentQuestion;
  if(!s || !q) return null;
  if(s.viewerAnswer && s.viewerAnswer.questionId === q.id) return s.viewerAnswer;
  return (s.challengeAnswers || []).find(a => a.questionId === q.id && a.playerId === state.playerId) || null;
}
function optionValue(label=''){
  const txt = String(label).trim().toLowerCase();
  if(txt === 'me') return 'me';
  if(txt === 'my partner' || txt === 'partner') return 'partner';
  if(txt === 'both') return 'both';
  if(txt === 'neither') return 'neither';
  return txt;
}
function minglePanel(s){
  const c = myCouple();
  const partnerNames = c ? c.players.filter(p => p.id !== state.playerId).map(p => p.name).join(' + ') : '';
  const endsAt = s.currentMingle?.endsAt || '';
  const starters = s.currentMingle?.starters || [];
  return `<div class="card guided-card"><div class="row between"><h1>Couple Mingle</h1>${endsAt?`<span class="pill timer-pill">Talk Time <span data-countdown-target="${esc(endsAt)}">${countdownText(endsAt)}</span></span>`:''}</div><p>${partnerNames?`Your partner: <b>${esc(partnerNames)}</b>`:'Meet your partner and get ready for the first challenge.'}</p><p class="muted">These conversation starters are optional. Talk naturally if you already know what to say.</p><div class="grid">${starters.slice(0,4).map(x=>`<div class="profile"><span>${esc(x)}</span></div>`).join('')}</div></div>`;
}
function winnerPanel(s){
  const winner=s.winner?.coupleName || s.voteCounts?.[0]?.coupleName || 'Bar Island Champions';
  return `<div class="card guided-card winner-card"><h1>Winner Reveal</h1><div class="winner-name">${esc(winner)}</div><p>Thanks for playing Bar Island.</p></div>`;
}
function questionProgress(s){ const p=s.answerProgress; if(!s.currentQuestion||!p) return ''; return `<div class="profile"><b>Current Question</b><span>${esc(s.currentQuestion.type)} · ${esc(s.currentQuestion.id)}</span><span>Players answered: ${p.answeredPlayers}/${p.totalPlayers}</span><span>Couples complete: ${p.completeCouples}/${p.totalCouples}</span></div>`; }
function profile(p){ return `<div class="profile ${p.status==='dumped'?'danger':''}"><div class="row between"><b>${esc(p.name)}</b><span class="pill ${p.status==='dumped'?'danger':'good'}">${esc(p.status)}</span></div><span>💚 ${esc(p.greenFlag||'No green flag yet')}</span><span>🚩 ${esc(p.redFlag||'No red flag yet')}</span><span>🧲 ${esc(p.type||'Mystery type')}</span><p>${esc(p.bio||p.pickup||'No profile answer yet.')}</p></div>`; }
function couplesPanel(s){ if(!s.couples.length) return `<div class="card"><h1>No Couples Yet</h1><p>The host will start First Coupling soon.</p></div>`; return `<div class="card"><h1>Couples</h1><div class="grid">${s.couples.map(c=>`<div class="profile couple"><h3>${esc(c.players.map(p=>p.name).join(' + ')||'Single')}</h3>${c.players.map(profile).join('')}</div>`).join('')}</div></div>`; }
function challengePanel(s){
  if(state.role!=='player') return `<div class="card"><h1>Audience</h1><p>Audience members vote, but do not submit couple answers.</p></div>`;
  const c=myCouple(); if(!c) return `<div class="card"><h1>Not Coupled Yet</h1><p>Wait for the host to form couples.</p></div>`;
  const q=s.currentQuestion; if(!q){ if(s.currentMingle) return minglePanel(s); return `<div class="card"><h1>No Question Live</h1><p>The host has not started a timed question yet. When a challenge starts, your answer area will appear here.</p></div>`; }
  const ans=myAnswer(); const locked=q.locked || Date.parse(q.endsAt)<=serverNowMs();
  return `<div class="card"><div class="row between"><h1>Question</h1><span class="pill timer-pill">Time Left <span data-countdown-target="${esc(q.endsAt)}">${countdownText(q.endsAt)}</span></span></div><p class="leader">${esc(q.text)}</p><p>Your couple: <b>${esc(c.players.map(p=>p.name).join(' + '))}</b></p>${ans?`<div class="profile good"><b>Submitted</b><span>${esc(ans.text || ans.option)}</span><span class="muted">Waiting on the host to reveal results.</span></div>`:answerForm(q,locked)}</div>`;
}
function answerForm(q, locked){ if(q.type==='choice'){ return `<form id="answerForm" class="grid one">${(q.options||[]).map(o=>`<button type="submit" name="option" value="${esc(optionValue(o))}" data-label="${esc(o)}" ${locked?'disabled':''}>${esc(o)}</button>`).join('')}</form>${locked?'<p class="danger pill">Time is up.</p>':''}`; } return `<form id="answerForm"><label>Your Answer<textarea name="text" ${locked?'disabled':''} maxlength="220" placeholder="Keep it funny and bar-friendly"></textarea></label><button ${locked?'disabled':''}>Submit Answer</button></form>${locked?'<p class="danger pill">Time is up.</p>':''}`; }
function votePanel(s){ const active=['vote','finale','challenge1','challenge2'].includes(s.phase); const m=me(); return `<div class="card"><h1>Vote</h1><p>${state.role==='player'?'Players can vote for other couples only.':'Audience voters can vote for any couple.'}</p>${s.couples.map(c=>{ const own=state.role==='player' && m?.coupleId===c.id; return `<div class="vote-row profile"><div><b>${esc(c.players.map(p=>p.name).join(' + ')||'Single')}</b><br><span class="muted">${own?'Your couple — self vote blocked':'Eligible for vote'}</span></div><button ${(!active||own)?'disabled':''} onclick="vote('${c.id}')">Vote</button></div>`; }).join('')}</div>`; }
function recouplePanel(s){ if(state.role!=='player') return `<div class="card"><h1>Recoupling</h1><p>Audience can watch the drama, but only players submit recoupling choices.</p></div>`; const active=s.phase==='recoupling'; const otherPlayers=s.players.filter(p=>p.id!==state.playerId && p.status!=='dumped'); return `<div class="card"><h1>Recoupling</h1><p>Choose your move. The host sees all requests and announces the result.</p><form id="recoupleForm"><label>Your Move<select name="choice" ${!active?'disabled':''}><option value="stay">Stay loyal</option><option value="switch">Switch/steal someone</option><option value="single">Go single</option></select></label><label>Target Player<select name="targetPlayerId" ${!active?'disabled':''}><option value="">No target</option>${otherPlayers.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label><button ${!active?'disabled':''}>Submit Recoupling Choice</button></form></div>`; }
function leaderboard(s){ if(!s.voteCounts?.length) return '<p>No votes yet.</p>'; return `<h3>Vote Board</h3>${s.voteCounts.map((v,i)=>`<div class="row between profile"><span class="leader">${i+1}. ${esc(v.coupleName)}</span><span class="pill">${v.votes} votes</span></div>`).join('')}`; }
function answers(s){ if(!s.challengeAnswers?.length) return '<p>No answers revealed yet.</p>'; return s.challengeAnswers.map(a=>`<div class="profile"><b>${esc(a.coupleName)} ${a.playerName?`· ${esc(a.playerName)}`:''}</b><p>${esc(a.text || a.option)}</p></div>`).join(''); }
window.vote=async(coupleId)=>{ try{ const data=await api('/api/vote',{method:'POST',body:JSON.stringify({code:state.code,voterType:state.role,voterId:state.role==='player'?state.playerId:state.audienceId,coupleId})}); state.session=data.session; syncClock(data.session.serverTime); renderGame(); toast('Vote counted.'); }catch(e){toast(e.message);} };
document.addEventListener('submit',async ev=>{
  if(ev.target.id==='answerForm'){
    ev.preventDefault(); const fd=new FormData(ev.target); const submitter=ev.submitter; const option=submitter?.name==='option' ? String(submitter.value || '') : ''; const text=fd.get('text') || submitter?.dataset?.label || submitter?.textContent?.trim() || option;
    try{ const data=await api('/api/answer',{method:'POST',body:JSON.stringify({code:state.code,playerId:state.playerId,option,text})}); state.session=data.session; syncClock(data.session.serverTime); renderGame(); toast('Answer submitted.'); }catch(e){toast(e.message);}
  }
  if(ev.target.id==='recoupleForm'){
    ev.preventDefault(); const f=Object.fromEntries(new FormData(ev.target).entries()); try{ const data=await api('/api/recouple',{method:'POST',body:JSON.stringify({code:state.code,playerId:state.playerId,...f})}); state.session=data.session; syncClock(data.session.serverTime); renderGame(); toast('Recoupling choice submitted.'); }catch(e){toast(e.message);}
  }
});
if(state.code && (state.playerId || state.audienceId)){ refresh(true); startPolling(); } else landing();
