// WebValo shell — screens, agent select, armory, HUD bridge.

import { AGENTS, cardBackground, cardFigure } from './agents.js';
import { WEAPONS, CATEGORIES, SHIELDS, getWeapon } from './weapons.js';
import { Game, KILL_GOAL } from './game.js';
import { preloadMatch } from './models.js';
import { settings, saveSettings } from './settings.js';

const $ = (sel) => document.querySelector(sel);

let selectedAgent = null;
let game = null;
let store = null; // preloaded gun models, reused across rematches

// ---------------------------------------------------------------- screens
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(id).classList.add('active');
}

// ---------------------------------------------------------------- agent select
function buildAgentSelect() {
  const rail = $('#agent-rail');
  rail.innerHTML = '';
  AGENTS.forEach((agent, i) => {
    const card = document.createElement('button');
    card.className = 'agent-card';
    card.dataset.id = agent.id;
    card.innerHTML = `
      <div class="card-bg" style="background:${cardBackground(agent)}"></div>
      <div class="card-figure" style="background:${cardFigure(agent)}"></div>
      <div class="card-num">0${i + 1}</div>
      <div class="card-role">${agent.role}</div>
      <div class="card-name">${agent.name}</div>`;
    card.addEventListener('click', () => selectAgent(agent));
    card.addEventListener('mouseenter', () => renderDetail(agent));
    rail.appendChild(card);
  });
  renderDetail(AGENTS[0]);
}

function selectAgent(agent) {
  selectedAgent = agent;
  document.querySelectorAll('.agent-card').forEach((c) =>
    c.classList.toggle('selected', c.dataset.id === agent.id));
  renderDetail(agent);
  $('#btn-lock').disabled = false;
}

function renderDetail(agent) {
  const slots = ['C', 'Q', 'E', 'X'];
  $('#agent-detail').innerHTML = `
    <div class="detail-role">// ${agent.role}</div>
    <h3 class="detail-name" style="color:${agent.color}">${agent.name}</h3>
    <p class="detail-bio">${agent.bio}</p>
    <div class="detail-abilities">
      ${slots.map((k) => {
        const ab = agent.abilities[k];
        return `<div class="detail-ab ${k === 'X' ? 'ult' : ''}">
          <span class="key">${k}</span>
          <span class="ab-ic">${ab.icon}</span>
          <span class="ab-name">${ab.name}</span>
          <span class="ab-desc">${ab.desc}</span>
        </div>`;
      }).join('')}
    </div>`;
}

// ---------------------------------------------------------------- armory
// Hotkeys follow on-screen order: 1–9 for guns, L / H for shields.
const BUY_ORDER = CATEGORIES.flatMap((c) => WEAPONS.filter((w) => w.cat === c));
const HOTKEYS = Object.fromEntries(BUY_ORDER.map((w, i) => [`Digit${i + 1}`, w.id]));

// Side-profile gun silhouette, generated from the weapon's class.
function gunSvg(w) {
  const P = {
    SIDEARM: { body: 34, barrel: w.id === 'shorty' ? 20 : w.id === 'sheriff' ? 22 : 14, stock: 0, mag: 0, grip: 1, scope: 0 },
    SMG: { body: 46, barrel: 18, stock: 18, mag: 1, grip: 1, scope: 0 },
    RIFLE: { body: 56, barrel: w.id === 'bulldog' ? 22 : 30, stock: 26, mag: 1, grip: 1, scope: w.id === 'vandal' ? 0 : 0 },
    SNIPER: { body: 60, barrel: 44, stock: 30, mag: 1, grip: 1, scope: 1 },
    HEAVY: { body: 64, barrel: 26, stock: 24, mag: 2, grip: 1, scope: 0 },
  }[w.type];
  const total = P.stock + P.body + P.barrel;
  const x0 = (140 - total) / 2;
  const bx = x0 + P.stock;
  const parts = [];
  if (P.stock) parts.push(`<path d="M${x0} 22 L${bx} 18 L${bx} 32 L${x0 + 4} 36 L${x0} 34 Z"/>`);
  parts.push(`<rect x="${bx}" y="16" width="${P.body}" height="${w.type === 'SIDEARM' ? 12 : 14}" rx="2"/>`);
  parts.push(`<rect x="${bx + P.body}" y="${w.type === 'SIDEARM' ? 18 : 19}" width="${P.barrel}" height="${w.id === 'shorty' ? 7 : 5}" rx="1"/>`);
  if (P.grip) parts.push(`<path d="M${bx + (w.type === 'SIDEARM' ? 2 : P.body * 0.28)} 28 l10 0 l-4 16 l-9 0 Z"/>`);
  if (P.mag === 1) parts.push(`<path d="M${bx + P.body * 0.5} 30 l9 0 l${w.id === 'vandal' ? 5 : 2} 13 l-9 1 Z"/>`);
  if (P.mag === 2) parts.push(`<rect x="${bx + P.body * 0.4}" y="30" width="18" height="10" rx="4"/>`);
  if (P.scope) parts.push(`<rect x="${bx + 10}" y="7" width="34" height="7" rx="3"/><rect x="${bx + 22}" y="13" width="6" height="4"/>`);
  if (w.type !== 'SIDEARM' && !P.scope) parts.push(`<rect x="${bx + 14}" y="12" width="14" height="4" rx="1"/>`);
  return `<svg viewBox="0 0 140 48" class="gun-svg" aria-hidden="true">${parts.join('')}</svg>`;
}

const CAT_LABEL = { SIDEARMS: 'SIDEARMS', SMGS: 'SMGS', RIFLES: 'RIFLES', SNIPERS: 'SNIPER', HEAVIES: 'HEAVY' };

function buildBuyMenu() {
  const grid = $('#buy-grid');
  grid.innerHTML = '';
  for (const cat of CATEGORIES) {
    const col = document.createElement('div');
    col.className = 'buy-col';
    col.innerHTML = `<div class="buy-cat mono">${CAT_LABEL[cat]}</div>`;
    for (const w of WEAPONS.filter((x) => x.cat === cat)) {
      const key = BUY_ORDER.indexOf(w) + 1;
      const item = document.createElement('button');
      item.className = 'buy-item';
      item.dataset.id = w.id;
      const dps = Math.round(w.dmg * (w.pellets || 1) * w.fireRate);
      item.innerHTML = `
        <div class="bi-top"><span class="bi-name">${w.name}</span><span class="bi-key mono">${key}</span></div>
        ${gunSvg(w)}
        <div class="bi-bars">
          <span>DMG</span><i><b style="width:${Math.min(100, (w.dmg * (w.pellets || 1)) / 1.5)}%"></b></i>
          <span>RATE</span><i><b style="width:${Math.min(100, w.fireRate / 16 * 100)}%"></b></i>
        </div>
        <div class="bi-bottom"><span class="bi-price mono">${w.price ? `$${w.price.toLocaleString()}` : 'FREE'}</span><span class="bi-tag mono"></span></div>`;
      item.title = `${w.name} — ${w.type} · ${w.dmg} dmg${w.pellets ? ` ×${w.pellets}` : ''} · ${w.fireRate}/s · mag ${w.mag} · ~${dps} dps`;
      item.addEventListener('click', () => buyWeapon(w.id));
      item.addEventListener('contextmenu', (e) => { e.preventDefault(); sellWeapon(w.id); });
      col.appendChild(item);
    }
    grid.appendChild(col);
  }
  // shields column
  const col = document.createElement('div');
  col.className = 'buy-col shields';
  col.innerHTML = '<div class="buy-cat mono">SHIELDS</div>';
  for (const sh of SHIELDS) {
    const item = document.createElement('button');
    item.className = 'buy-item shield';
    item.dataset.shield = sh.id;
    item.innerHTML = `
      <div class="bi-top"><span class="bi-name">${sh.name}</span><span class="bi-key mono">${sh.id === 'light' ? 'L' : 'H'}</span></div>
      <div class="shield-ic">${sh.id === 'light' ? '◇' : '◆'}<span>+${sh.amount}</span></div>
      <div class="bi-bottom"><span class="bi-price mono">$${sh.price.toLocaleString()}</span><span class="bi-tag mono"></span></div>`;
    item.addEventListener('click', () => buyShield(sh.id));
    col.appendChild(item);
  }
  grid.appendChild(col);
}

function buyToast(text, bad = false) {
  const el = $('#buy-toast');
  el.textContent = text;
  el.classList.toggle('bad', bad);
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

function flashItem(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.classList.remove('bought'); void el.offsetWidth; el.classList.add('bought');
}

function buyWeapon(id) {
  if (!game) return;
  const w = getWeapon(id);
  const r = game.tryBuy(w);
  if (r === 'ok') { buyToast(`${w.name} EQUIPPED`); flashItem(`.buy-item[data-id="${id}"]`); }
  else if (r === 'poor') buyToast(`NEED $${(w.price - game.money).toLocaleString()} MORE`, true);
  else buyToast(`${w.name} ALREADY OWNED`);
}

function sellWeapon(id) {
  if (!game) return;
  const w = getWeapon(id);
  if (game.trySell(w)) buyToast(`SOLD ${w.name} +$${w.price.toLocaleString()}`);
}

function buyShield(id) {
  if (!game) return;
  const sh = SHIELDS.find((s) => s.id === id);
  const r = game.tryBuyShield(sh);
  if (r === 'ok') { buyToast(`${sh.name} EQUIPPED`); flashItem(`.buy-item[data-shield="${id}"]`); }
  else if (r === 'poor') buyToast(`NEED $${(sh.price - game.money).toLocaleString()} MORE`, true);
  else buyToast('SHIELD ALREADY FULL');
}

function onQuickBuy(code) {
  if (code === 'KeyL') return buyShield('light');
  if (code === 'KeyH') return buyShield('heavy');
  if (HOTKEYS[code]) buyWeapon(HOTKEYS[code]);
}

// Reflect current credits in the HUD + armory, and gate affordability.
function onMoney(money, slots, armor) {
  const txt = `$${money.toLocaleString()}`;
  const m = $('#money'); if (m) m.textContent = txt;
  document.querySelectorAll('.buy-money').forEach((el) => { el.textContent = txt; });
  const owned = new Set(Object.values(slots).filter(Boolean).map((s) => s.weapon.id));
  document.querySelectorAll('.buy-item[data-id]').forEach((el) => {
    const w = getWeapon(el.dataset.id);
    const has = owned.has(w.id);
    const slot = slots[w.slot];
    el.classList.toggle('owned', has);
    el.classList.toggle('cant-afford', !has && money < w.price);
    el.querySelector('.bi-tag').textContent = has ? (slot && slot.boughtThisLife && w.price ? 'OWNED · RMB SELL' : 'OWNED') : '';
  });
  document.querySelectorAll('.buy-item[data-shield]').forEach((el) => {
    const sh = SHIELDS.find((s) => s.id === el.dataset.shield);
    const full = armor >= sh.amount;
    el.classList.toggle('owned', full);
    el.classList.toggle('cant-afford', !full && money < sh.price);
    el.querySelector('.bi-tag').textContent = full ? 'EQUIPPED' : '';
  });
}

function onBuyMenu(open) {
  $('#buy-menu').classList.toggle('hidden', !open);
  if (open) $('#buy-toast').classList.remove('show');
}

// ---------------------------------------------------------------- HUD bridge
function buildAbilityBar(agent) {
  const bar = $('#ability-bar');
  const slots = ['C', 'Q', 'E', 'X'];
  bar.innerHTML = slots.map((k) => {
    const ab = agent.abilities[k];
    const ult = k === 'X';
    const charges = ab.charges || 1;
    return `<div class="ability ${ult ? 'ult' : 'ready'}" id="ab-${k}" title="${ab.name}">
      <span class="ic">${ab.icon}</span>
      <span class="kb">${k}</span>
      <span class="cd" id="cd-${k}"></span>
      ${charges > 1 ? `<span class="charge-badge" id="ch-${k}">${charges}</span>` : ''}
      ${ult ? `<span class="ult-pips">${Array.from({ length: ab.pts }, (_, i) => `<span class="pip" id="pip-${i}"></span>`).join('')}</span>` : ''}
    </div>`;
  }).join('');
}

function onAbilityHud(abilityState, ultPoints, now) {
  for (const k of ['C', 'Q', 'E']) {
    const el = $(`#ab-${k}`);
    const st = abilityState[k] || { count: 0, max: 1, pending: [] };
    const remaining = st.pending.length && st.count < st.max ? st.pending[0] - now : 0;
    el.classList.toggle('cooling', st.count <= 0 && remaining > 0);
    el.classList.toggle('ready', st.count > 0);
    $(`#cd-${k}`).textContent = st.count <= 0 && remaining > 0 ? Math.ceil(remaining) : '';
    const badge = $(`#ch-${k}`);
    if (badge) {
      badge.textContent = st.count;
      badge.classList.toggle('depleted', st.count <= 0);
      badge.classList.toggle('partial', st.count > 0 && st.count < st.max);
    }
  }
  const ultAb = selectedAgent.abilities.X;
  const ultEl = $('#ab-X');
  ultEl.classList.toggle('ready', ultPoints >= ultAb.pts);
  for (let i = 0; i < ultAb.pts; i++) {
    const pip = $(`#pip-${i}`);
    if (pip) pip.classList.toggle('on', i < ultPoints);
  }
}

function onSlots(slots, active, ult) {
  const rows = [['1', slots.primary, 'primary'], ['2', slots.secondary, 'secondary']];
  $('#weapon-slots').innerHTML = rows.map(([k, s, id]) =>
    `<div class="wslot ${!ult && active === id ? 'active' : ''} ${s ? '' : 'empty'}"><span class="mono">${k}</span>${s ? s.weapon.name : '—'}</div>`).join('');
}

function onKillFeed(killer, victim, headshot, enemy, weapon = '') {
  const feed = $('#killfeed');
  const row = document.createElement('div');
  row.className = `kf-row ${enemy ? 'enemy' : ''}`;
  row.innerHTML = `<span class="k">${killer}</span><span class="w">${weapon}</span>${headshot ? '<span class="hs">◎</span>' : ''}<span class="d">${victim}</span>`;
  feed.prepend(row);
  while (feed.children.length > 5) feed.lastChild.remove();
  setTimeout(() => row.remove(), 5000);
}

function onScore(kills, deaths) {
  $('#score-ally').textContent = kills;
  $('#score-enemy').textContent = deaths;
}

function onAnnounce(text, red) {
  const el = $('#announce');
  el.textContent = text;
  el.classList.remove('show', 'red');
  void el.offsetWidth;
  el.classList.add('show');
  if (red) el.classList.add('red');
}

const STREAK_LABELS = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'QUADRA KILL', 5: 'ACE' };
function onStreak(count) {
  const el = $('#streak');
  el.textContent = count >= 6 ? `RAMPAGE ×${count}` : (STREAK_LABELS[count] || `${count} KILLS`);
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
}

function onReward(amount, headshot) {
  const el = $('#reward');
  el.textContent = `+$${amount}${headshot ? ' HS' : ''}`;
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
}

let lastClock = '';
function onClock(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const txt = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (txt !== lastClock) { lastClock = txt; $('#round-clock').textContent = txt; $('#round-clock').classList.toggle('low', s <= 60); }
}

let scoped = false;
function onScope(on) {
  if (on === scoped) return;
  scoped = on;
  $('#scope-overlay').classList.toggle('hidden', !on);
}

function onLockPrompt(show) { $('#lock-prompt').classList.toggle('hidden', !show); }

let deathTimer = null;
function onDeath(killer, headshot, delay) {
  $('#death-killer').textContent = killer;
  $('#death-killer').classList.toggle('hs', headshot);
  const info = $('#death-info');
  let left = delay;
  info.textContent = `${headshot ? 'HEADSHOT · ' : ''}RESPAWNING IN ${left}`;
  clearInterval(deathTimer);
  deathTimer = setInterval(() => {
    if (game && game.simPaused()) return; // countdown holds while shopping/paused
    left = Math.max(1, left - 1);
    info.textContent = `${headshot ? 'HEADSHOT · ' : ''}RESPAWNING IN ${left}`;
  }, 1000);
  $('#death-screen').classList.remove('hidden');
}
function onRespawn() {
  clearInterval(deathTimer);
  $('#death-screen').classList.add('hidden');
}

function onScoreboard(show, rows) {
  const board = $('#tab-board');
  board.classList.toggle('hidden', !show);
  if (!show) return;
  rows.sort((a, b) => b.k - a.k || a.d - b.d);
  $('#tab-rows').innerHTML = rows.map((r) =>
    `<tr class="${r.you ? 'you' : 'bot'}"><td>${r.name}</td><td class="mono">${r.agent}</td><td>${r.k}</td><td>${r.d}</td></tr>`).join('');
}

function onMatchEnd(s) {
  clearInterval(deathTimer);
  clearInterval(window._hudTick);
  $('#death-screen').classList.add('hidden');
  $('#buy-menu').classList.add('hidden');
  $('#tab-board').classList.add('hidden');
  const title = $('#end-title');
  title.textContent = s.won ? 'VICTORY' : 'DEFEAT';
  title.classList.toggle('lost', !s.won);
  const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : s.kills.toFixed(2);
  const mm = Math.floor(s.time / 60), ss = String(Math.floor(s.time % 60)).padStart(2, '0');
  $('#end-stats').innerHTML = [
    ['SCORE', `${s.kills} – ${s.deaths}`], ['K/D', kd], ['ACCURACY', `${s.acc}%`],
    ['HEADSHOT %', `${s.hs}%`], ['DAMAGE', s.damage.toLocaleString()], ['TIME', `${mm}:${ss}`],
  ].map(([k, v]) => `<div><span class="mono">${k}</span><b>${v}</b></div>`).join('');
  setTimeout(() => $('#match-end').classList.remove('hidden'), 900);
}

// ---------------------------------------------------------------- match lifecycle
// Preload models behind a progress bar, then gate the actual launch behind a
// DEPLOY click — pointer lock requires a fresh user gesture, which an awaited
// preload would otherwise consume.
async function startMatch() {
  showScreen('#screen-game');
  const loading = $('#loading');
  const fill = $('#loading-fill');
  const status = $('#loading-status');
  const title = $('#loading-title');
  const deploy = $('#btn-deploy');
  loading.classList.remove('hidden');
  deploy.classList.add('hidden');
  title.textContent = 'DEPLOYING';
  status.textContent = 'STREAMING ASSETS…';
  fill.style.width = '0%';

  if (!store) {
    try {
      store = await preloadMatch((p) => { fill.style.width = `${Math.round(p * 100)}%`; });
    } catch (e) {
      console.warn('[match] model preload failed, using procedural fallback', e);
    }
  }
  fill.style.width = '100%';
  title.textContent = 'READY';
  status.textContent = `${selectedAgent.name} // FORGE // FIRST TO ${KILL_GOAL}`;
  deploy.classList.remove('hidden');
  deploy.onclick = () => launch();
}

function launch() {
  $('#loading').classList.add('hidden');
  $('#match-end').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  $('#goal').textContent = `FIRST TO ${KILL_GOAL}`;
  $('#killfeed').innerHTML = '';
  buildAbilityBar(selectedAgent);
  buildBuyMenu();
  onScore(0, 0);
  if (game) { game.destroy(); game = null; }

  game = new Game($('#game-canvas'), selectedAgent, {
    onKillFeed, onScore, onAnnounce, onAbilityHud, onQuickBuy, onStreak, onMoney, onBuyMenu,
    onSlots, onReward, onClock, onScope, onLockPrompt, onDeath, onRespawn, onScoreboard, onMatchEnd,
  }, store);
  window.__game = game; // debug handle
  game.updateHud();
  game.start();

  clearInterval(window._hudTick);
  window._hudTick = setInterval(() => {
    if (game && game.running) onAbilityHud(game.abilityState, game.ultPoints, game.now());
  }, 250);
}

function quitMatch() {
  clearInterval(window._hudTick);
  clearInterval(deathTimer);
  if (game) { game.destroy(); game = null; }
  for (const id of ['#hud', '#buy-menu', '#pause-menu', '#death-screen', '#match-end', '#tab-board', '#scope-overlay']) $(id).classList.add('hidden');
  scoped = false;
  showScreen('#screen-agents');
}

// ---------------------------------------------------------------- settings
function initSettingsUI() {
  const sens = $('#set-sens'), sensV = $('#set-sens-val');
  const fov = $('#set-fov'), fovV = $('#set-fov-val');
  const vol = $('#set-vol'), volV = $('#set-vol-val');
  const motion = $('#set-motion'), fps = $('#set-fps'), dmgnum = $('#set-dmgnum');
  const diff = $('#set-diff');

  const syncSwitch = (el, on) => { el.classList.toggle('on', on); el.setAttribute('aria-checked', on); };
  const syncDiff = () => diff.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === settings.difficulty));
  sens.value = settings.sens; sensV.textContent = settings.sens.toFixed(2);
  fov.value = settings.fov; fovV.textContent = settings.fov;
  vol.value = settings.volume; volV.textContent = `${Math.round(settings.volume * 100)}%`;
  syncSwitch(motion, settings.reducedMotion);
  syncSwitch(fps, settings.showFps);
  syncSwitch(dmgnum, settings.damageNumbers);
  syncDiff();

  const apply = () => { saveSettings(); if (game) game.applySettings(); };
  sens.oninput = () => { settings.sens = +sens.value; sensV.textContent = settings.sens.toFixed(2); apply(); };
  fov.oninput = () => { settings.fov = +fov.value; fovV.textContent = settings.fov; apply(); };
  vol.oninput = () => { settings.volume = +vol.value; volV.textContent = `${Math.round(settings.volume * 100)}%`; apply(); };
  motion.onclick = () => { settings.reducedMotion = !settings.reducedMotion; syncSwitch(motion, settings.reducedMotion); apply(); };
  fps.onclick = () => { settings.showFps = !settings.showFps; syncSwitch(fps, settings.showFps); apply(); };
  dmgnum.onclick = () => { settings.damageNumbers = !settings.damageNumbers; syncSwitch(dmgnum, settings.damageNumbers); apply(); };
  diff.querySelectorAll('button').forEach((b) => { b.onclick = () => { settings.difficulty = b.dataset.v; syncDiff(); apply(); }; });
}
const openSettings = () => $('#settings-modal').classList.remove('hidden');
const closeSettings = () => $('#settings-modal').classList.add('hidden');

// ---------------------------------------------------------------- wiring
$('#btn-play').addEventListener('click', () => showScreen('#screen-agents'));
$('#btn-back-landing').addEventListener('click', () => showScreen('#screen-landing'));
$('#btn-lock').addEventListener('click', () => { if (selectedAgent) startMatch(); });
$('#btn-resume').addEventListener('click', () => game && game.setPaused(false));
$('#btn-quit').addEventListener('click', quitMatch);
$('#btn-settings').addEventListener('click', openSettings);
$('#btn-settings-pause').addEventListener('click', openSettings);
$('#btn-settings-close').addEventListener('click', closeSettings);
$('#btn-again').addEventListener('click', launch);
$('#btn-end-menu').addEventListener('click', quitMatch);

initSettingsUI();
buildAgentSelect();
