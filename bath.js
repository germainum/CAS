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

/* -------------------------------------------------------------- contrôle */

function start() {
  armAudio();
  session = { startedAt: Date.now(), totalSec: minutes * 60 };
  beeped = { exit: false, done: false };
  save();
  open();
}

function open() {
  $('timer').hidden = false;
  document.body.classList.add('timing');
  renderTimer();
  clearInterval(ticker);
  ticker = setInterval(renderTimer, 250);
}

function stop() {
  clearInterval(ticker);
  ticker = null;
  session = null;
  save();
  $('timer').hidden = true;
  document.body.classList.remove('timing');
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

  $('bathStart').addEventListener('click', start);
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
    open();
  }
}
