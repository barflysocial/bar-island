const $ = (id) => document.getElementById(id);

function esc(s) {
  return String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function fmt(ms) {
  ms = Math.max(0, ms || 0);
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const h = Math.floor(m / 60);
  return h
    ? `${h}:${String(m % 60).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

let serverOffsetMs = 0;
function nowMs() { return Date.now() + serverOffsetMs; }
function left(iso) {
  return iso ? new Date(iso).getTime() - nowMs() : 0;
}

function phaseLabel(p) {
  return ({
    lobby: 'Lobby',
    first_impressions: 'First Impressions',
    couple_up: 'Couple Up',
    mingle: 'Mingle Time',
    redflag: 'Red Flag / Green Flag',
    chemistry: 'Chemistry Check',
    spill: 'Spill the Tea',
    temptation: 'Temptation / Switch-Up',
    recoupling: 'Recoupling',
    survival: 'Survival Challenge',
    audience_vote: 'Audience Voting',
    finale_pitch: 'Finale Pitch',
    final_winner_vote: 'Final Winner Vote',
    winner: 'Winner Reveal',
    cashout: 'Cash Out or Double Down',
    replacement: 'Replacement Teams',
    ended: 'Ended'
  })[p] || p;
}

function initials(n) {
  return (n || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0]?.toUpperCase()).join('') || '?';
}

function avatar(p) {
  return p?.photo
    ? `<img class="avatar big" src="${p.photo}" alt="${esc(p.name || 'Player')}">`
    : `<div class="avatar big">${initials(p?.name)}</div>`;
}

function activeCouples(s) {
  return (s?.couples || []).filter(c => c.status === 'active');
}

function playersFor(s, c) {
  return (c?.playerIds || []).map(id => (s.players || []).find(p => p.id === id)).filter(Boolean);
}

function coupleName(s, c) {
  return playersFor(s, c).map(p => p.name).join(' + ') || 'Open Couple';
}

function gameClock(s) {
  if (!s?.gameStartedAt) return '00:00';
  return fmt(nowMs() - new Date(s.gameStartedAt).getTime() - (s.gameClockPausedMs || 0));
}

function counts(s) {
  const key = s.currentVoteKey;
  const c = {};
  (s.votes || []).filter(v => !key || v.voteKey === key).forEach(v => {
    c[v.targetCoupleId] = (c[v.targetCoupleId] || 0) + 1;
  });
  return c;
}
function reactionCounts(s) {
  const labels={hot:'🔥',red:'🚩',green:'💚',funny:'😂',messy:'😳'};
  const c={};
  (s.reactions||[]).filter(r=>r.phaseInstanceId===s.phaseInstanceId).forEach(r=>c[r.reaction]=(c[r.reaction]||0)+1);
  return Object.entries(c).map(([k,v])=>`<span class="pill public-react">${labels[k]||k} ${v}</span>`).join('');
}

function joinUrl(s) {
  const base = window.location.origin || '';
  const code = encodeURIComponent(s?.code || '');
  return `${base}/?code=${code}`;
}

function qrUrl(s, size = 320) {
  const data = encodeURIComponent(joinUrl(s));
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=${data}`;
}

function qrBlock(s, label = 'Scan to Join') {
  return `<div class="public-qr-card">
    <img class="public-qr" src="${qrUrl(s)}" alt="QR code to join Bar Island">
    <div class="public-qr-label">${esc(label)}</div>
    <div class="public-qr-code">Code: ${esc(s.code)}</div>
  </div>`;
}

let data = null;

async function load() {
  try {
    const r = await fetch('/api/sessions');
    data = await r.json();
    if (data.serverNow) serverOffsetMs = new Date(data.serverNow).getTime() - Date.now();
    render();
  } catch (e) {}
}

function cue(s) {
  const m = {
    lobby: 'Scan the QR code to join Bar Island.',
    mingle: 'Couples, start mingling.',
    audience_vote: 'Vote now using your phone.',
    final_winner_vote: 'Vote for the Bar Island Champions.',
    cashout: 'Top teams decide: cash out or double down.',
    replacement: 'Bombshell replacement teams may enter.',
    winner: 'Bar Island Champions!'
  };
  return m[s.phase] || 'Follow the host and watch the island change.';
}

function renderEmpty() {
  $('pub').innerHTML = `<div class="public-wrap"><div class="public-center"><div><div class="phase-title">BAR ISLAND</div><p class="cue">Waiting for next game</p></div></div></div>`;
}

function renderCards(s) {
  const vc = counts(s);
  if (['audience_vote', 'final_winner_vote', 'winner', 'cashout', 'replacement'].includes(s.phase)) {
    return activeCouples(s).slice(0, 6).map(c => `<div class="public-card"><div class="row" style="justify-content:center">${playersFor(s, c).map(p => avatar(p)).join('')}</div><h3>${esc(coupleName(s, c))}</h3><div class="pill">${vc[c.id] || 0} votes</div></div>`).join('');
  }
  return activeCouples(s).slice(0, 6).map(c => `<div class="public-card"><h3>${esc(coupleName(s, c))}</h3><div class="row" style="justify-content:center">${playersFor(s, c).map(p => avatar(p)).join('')}</div></div>`).join('');
}

function render() {
  const s = data?.activeSession;
  if (!s) return renderEmpty();

  const timer = s.phase === 'lobby'
    ? fmt(new Date(s.startTime).getTime() - Date.now())
    : fmt(left(s.phaseEndsAt));
  const winner = s.winnerCoupleId ? s.couples.find(c => c.id === s.winnerCoupleId) : null;
  const showTimer = Boolean(s.phaseEndsAt || s.phase === 'lobby');
  const showQr = ['lobby', 'audience_vote', 'final_winner_vote', 'replacement'].includes(s.phase);
  const cards = renderCards(s);

  let mainContent;
  if (s.phase === 'lobby') {
    mainContent = `<div class="public-lobby-layout">
      <div class="public-lobby-main">
        <div class="phase-title">${esc(phaseLabel(s.phase))}</div>
        <div class="timer public">${timer}</div>
        <div class="cue">${esc(cue(s))}</div><div class="public-reactions">${reactionCounts(s)}</div>
      </div>
      ${qrBlock(s, 'Scan to Join')}
    </div>`;
  } else {
    mainContent = `<div class="public-stage-layout">
      <div class="public-stage-main">
        <div class="phase-title">${esc(phaseLabel(s.phase))}</div>
        ${showTimer ? `<div class="timer public">${timer}</div>` : ''}
        <div class="cue">${winner ? `Winner: ${esc(coupleName(s, winner))}` : esc(cue(s))}</div><div class="public-reactions">${reactionCounts(s)}</div>
      </div>
      ${showQr ? qrBlock(s, s.phase === 'replacement' ? 'New Teams Join Here' : 'Vote / Join Here') : ''}
    </div>`;
  }

  $('pub').innerHTML = `<div class="public-wrap">
    <div class="public-top">
      <div><b>BAR ISLAND</b><div class="muted">Code: ${esc(s.code)} • Block ${s.blockIndex}/${s.maxBlocks}</div></div>
      <div class="game-clock">Game Clock: ${gameClock(s)}</div>
    </div>
    <div class="public-center">${mainContent}</div>
    <div class="public-grid">${cards}</div>
  </div>`;
}

setInterval(load, 3000);
setInterval(() => { if (data) render(); }, 1000);
load();
