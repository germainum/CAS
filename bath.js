// Minuteur de bain froid.
//
// La durée conseillée découle de la température de l'eau : une minute par degré,
// et c'est un plafond. Le décompte se calcule à partir d'un horodatage de départ,
// jamais par accumulation de ticks : iOS suspend le JavaScript quand l'app passe
// en arrière-plan ou que l'écran s'éteint, et un compteur incrémental dériverait.
// Une session en cours est conservée, de sorte qu'un rechargement ne la perde pas.

import { BATH_MAX_MINUTES, bathPhase, bathPlan, formatClock } from './sources.js';

const $ = (id) => document.getElementById(id);

const STORE = 'leman.v2.bath';
const MIN_MINUTES = 1;
const HOLD_MS = 1100;      // durée de maintien pour confirmer le lancement

let temp = null;          // température de l'eau connue
let minutes = null;       // durée retenue, ajustable par l'utilisateur
let manual = false;       // vrai dès que l'utilisateur a réglé la durée
let session = null;       // { startedAt, totalSec }
let ticker = null;
let audio = null;
let beeped = { exit: false, done: false };

/* ------------------------------------------------------------------- son */

// Le contexte doit naître d'un geste utilisateur, sinon iOS le laisse suspendu.
function armAudio() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch {
    audio = null;   // pas de son : le minuteur reste utilisable
  }
}

function beep(freq = 880, dur = 0.18, delay = 0) {
  if (!audio) return;
  const at = audio.currentTime + delay;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(audio.destination);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(0.28, at + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.start(at);
  osc.stop(at + dur + 0.02);
}

/* --------------------------------------------------------------- session */

function save() {
  try {
    if (session) localStorage.setItem(STORE, JSON.stringify(session));
    else localStorage.removeItem(STORE);
  } catch { /* navigation privée : la session vit alors en mémoire seulement */ }
}

function restore() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (!raw?.startedAt || !(raw.totalSec > 0)) return null;
    // Au-delà du double de la durée, la session est manifestement abandonnée.
    if (Date.now() - raw.startedAt > (raw.totalSec + 1800) * 1000) return null;
    return raw;
  } catch {
    return null;
  }
}

const elapsed = () => (Date.now() - session.startedAt) / 1000;

/* ----------------------------------------------------------------- rendu */

function renderPlan() {
  const plan = bathPlan(temp);
  if (minutes == null) minutes = plan ? plan.minutes : 5;

  $('bathMinutes').textContent = minutes;
  $('briefMinutes').textContent = minutes;
  $('bathStart').disabled = false;

  if (!plan) {
    $('bathNote').textContent = 'Température inconnue : durée à régler à la main.';
    return;
  }
  const parts = [`une minute par degré, soit ${plan.minutes} min à ${plan.temp.toFixed(1).replace('.', ',')} °C`];
  if (plan.capped) parts.push(`plafonné à ${BATH_MAX_MINUTES} min`);
  if (!plan.cold) parts.push('au-delà de 18 °C, ce n’est plus un bain froid');
  $('bathNote').textContent = `Maximum conseillé — ${parts.join(' · ')}.`;
}

function renderTimer() {
  if (!session) return;
  const el = elapsed();
  const left = session.totalSec - el;
  const phase = bathPhase(el, session.totalSec);

  $('timerClock').textContent = formatClock(Math.abs(left));
  $('timerPhase').textContent = phase.label;
  $('timerHint').textContent = phase.hint;
  $('timer').dataset.phase = phase.key;

  const pct = Math.min(100, (el / session.totalSec) * 100);
  $('timerFill').style.width = `${pct.toFixed(1)}%`;

  $('timerMeta').textContent = left >= 0
    ? `${formatClock(el)} écoulées sur ${formatClock(session.totalSec)}`
    : `dépassement de ${formatClock(-left)} — sors maintenant`;

  // Un son à l'approche de la sortie, trois à l'échéance. Sans effet si l'app
  // est en arrière-plan : iOS y suspend l'audio comme le reste.
  if (phase.key === 'exit' && !beeped.exit) { beeped.exit = true; beep(660, .14); }
  if (phase.key === 'done' && !beeped.done) {
    beeped.done = true;
    beep(880, .18); beep(880, .18, .28); beep(1180, .3, .56);
  }
}

/* ------------------------------------------------- confirmation à maintenir */

// Un simple appui suffirait techniquement. Le maintien impose une seconde
// d'attention sur les consignes, juste avant d'entrer dans l'eau — et rend
// impossible un lancement par mégarde dans la poche.
const RING = 2 * Math.PI * 43;
let holding = null;

function setHoldProgress(p) {
  const fill = $('holdFill');
  fill.style.strokeDasharray = String(RING);
  fill.style.strokeDashoffset = String(RING * (1 - Math.max(0, Math.min(1, p))));
}

function holdStep(now) {
  if (!holding) return;
  const p = (now - holding.from) / HOLD_MS;
  setHoldProgress(p);
  if (p >= 1) {
    holding = null;
    $('holdLabel').textContent = 'C’est parti';
    confirmStart();
    return;
  }
  holding.raf = requestAnimationFrame(holdStep);
}

function holdBegin(e) {
  if (holding) return;
  e.preventDefault();
  armAudio();                       // le contexte audio naît de ce geste
  holding = { from: performance.now() };
  $('holdBtn').classList.add('held');
  $('holdNote').textContent = 'Ne relâchez pas…';
  holding.raf = requestAnimationFrame(holdStep);
}

function holdEnd() {
  if (!holding) return;
  cancelAnimationFrame(holding.raf);
  holding = null;
  $('holdBtn').classList.remove('held');
  $('holdNote').textContent = 'Relâché trop tôt — maintenez une seconde';
  setHoldProgress(0);
}

/* -------------------------------------------------------------- contrôle */

// Étape de consignes : rien ne démarre encore.
function openBriefing() {
  $('briefMinutes').textContent = minutes;
  $('holdLabel').textContent = 'Maintenir';
  $('holdNote').textContent = 'Maintenez une seconde pour lancer';
  setHoldProgress(0);
  $('timer').dataset.state = 'briefing';
  $('timer').hidden = false;
  document.body.classList.add('timing');
  $('holdBtn').focus();
}

function confirmStart() {
  session = { startedAt: Date.now(), totalSec: minutes * 60 };
  beeped = { exit: false, done: false };
  save();
  beep(520, .12);                   // repère sonore de départ
  open();
}

function open() {
  $('timer').dataset.state = 'running';
  $('timer').hidden = false;
  document.body.classList.add('timing');
  renderTimer();
  clearInterval(ticker);
  ticker = setInterval(renderTimer, 250);
}

function close() {
  clearInterval(ticker);
  ticker = null;
  holdEnd();
  $('timer').hidden = true;
  document.body.classList.remove('timing');
}

function stop() {
  session = null;
  save();
  close();
}

function step(delta) {
  minutes = Math.min(BATH_MAX_MINUTES + 10, Math.max(MIN_MINUTES, minutes + delta));
  renderPlan();
}

/* ------------------------------------------------------------------ mise en place */

// Appelée à chaque rafraîchissement des données : la durée conseillée suit la
// température, tant que l'utilisateur ne l'a pas réglée lui-même.
export function setWaterTemperature(value) {
  temp = typeof value === 'number' && isFinite(value) ? value : null;
  // Un réglage manuel n'est pas écrasé par un rafraîchissement des données.
  if (!manual) minutes = bathPlan(temp)?.minutes ?? minutes ?? 5;
  renderPlan();
}

export function initBath() {
  renderPlan();

  $('bathStart').addEventListener('click', openBriefing);
  $('briefCancel').addEventListener('click', close);

  const btn = $('holdBtn');
  btn.addEventListener('pointerdown', holdBegin);
  btn.addEventListener('pointerup', holdEnd);
  btn.addEventListener('pointercancel', holdEnd);
  btn.addEventListener('pointerleave', holdEnd);
  // Au clavier, maintenir la touche produit le même engagement.
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') holdBegin(e);
  });
  btn.addEventListener('keyup', (e) => {
    if (e.key === 'Enter' || e.key === ' ') holdEnd();
  });
  $('bathMinus').addEventListener('click', () => { manual = true; step(-1); });
  $('bathPlus').addEventListener('click', () => { manual = true; step(1); });
  $('timerDone').addEventListener('click', stop);
  $('timerCancel').addEventListener('click', stop);

  // Retour au premier plan : on repart de l'horodatage, jamais du dernier tick.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && session) renderTimer();
  });

  const resumed = restore();
  if (resumed) {
    session = resumed;
    // Les sons déjà dus ne sont pas rejoués à la reprise.
    const el = elapsed();
    beeped = {
      exit: bathPhase(el, session.totalSec).key !== 'shock',
      done: el >= session.totalSec,
    };
    open();   // une session en cours reprend directement à l'immersion
  }
}
