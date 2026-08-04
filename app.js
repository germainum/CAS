// Température du Léman — réseau, cache et rendu.
//
// Deux sources complémentaires :
//   1. existenz.ch      → mesures in situ des stations hydrologiques de l'OFEV.
//   2. Alplakes / Eawag → simulation 3D du lac (Delft3D-FLOW) : une valeur pour
//                         n'importe quel point d'eau, plus l'historique et la
//                         prévision qui alimentent la courbe.
// Toute réponse utile est mise en cache (localStorage) : l'app affiche donc
// toujours quelque chose, hors ligne compris, en signalant l'âge de la donnée.

import { initBath, setWaterTemperature } from './bath.js';
import {
  CFG, SPOTS, asArray, bestReading, isStale, mood, nextIndex, parseMeasuredStations,
  parseSeries, parseSnapshot, parseStationMeta, snapshotAge, swipeDecision, toDate,
  urlLatestTemperature, urlModelPoint, urlModelSnapshot, urlStationMeta,
} from './sources.js';

const $ = (id) => document.getElementById(id);
const diagnostics = [];
let currentSpot = SPOTS[0];
let refreshing = false;

/* ------------------------------------------------------------------ affichage */

const formatTemp = (v) =>
  typeof v === 'number' && isFinite(v) ? v.toFixed(1).replace('.', ',') : '--';

function formatAge(value) {
  const date = toDate(value);
  if (!date) return '';
  const min = Math.round((Date.now() - date.getTime()) / 60000);
  if (min < 0) return 'prévision';
  if (min < 2) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d === 1 ? 'hier' : `il y a ${d} jours`;
}

// Deuxième ligne de la lecture chiffrée, tenue courte : elle est en capitales
// sous le nom du lieu et ne doit pas se casser sur trois lignes.
// « mesure · Chillon » + 25 min → « CHILLON · 25 MIN », et le nom de la station
// disparaît quand il répète celui du lieu.
function shortSource(label, at) {
  const age = formatAge(at).replace(/^il y a /, '');
  const station = /^mesure/.test(label) ? label.replace(/^mesure\s*·\s*/, '') : null;
  let head = label;
  if (station) {
    const spot = currentSpot.name.toLowerCase();
    const low = station.toLowerCase();
    // « Genève » → « mesure » ; « Genève, sortie du lac » → « sortie du lac ».
    head = low === spot ? 'mesure'
      : low.startsWith(`${spot},`) ? station.slice(spot.length + 1).trim()
      : station;
  }
  return [head, age].filter(Boolean).join(' · ');
}

function note(source, ok, detail) {
  const time = new Date().toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit' });
  diagnostics.push(`${ok ? '✓' : '✗'} ${time} ${source} — ${detail}`);
  $('diagOut').textContent = diagnostics.slice(-14).join('\n');
}

function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* -------------------------------------------------------------------- réseau */

// Résumé d'URL pour le diagnostic : hôte et chemin, sans schéma ni clé d'app.
function shortUrl(url) {
  try {
    const u = new URL(url);
    const tail = `${u.host}${u.pathname}`;
    return tail.length > 96 ? `${tail.slice(0, 93)}…` : tail;
  } catch {
    return url;
  }
}

async function getJSON(url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CFG.timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    // L'URL fait partie du diagnostic : sans elle, « Load failed » n'apprend rien.
    const reason = err.name === 'AbortError' ? 'délai dépassé' : err.message;
    throw new Error(`${reason} — ${shortUrl(url)}`);
  } finally {
    clearTimeout(timer);
  }
}

/* --------------------------------------------------------------------- cache */

// La version du préfixe invalide tout le cache local. À incrémenter dès qu'une
// donnée mise en cache change de forme ou s'est révélée fausse — sans quoi les
// appareils déjà utilisés conservent l'ancienne pendant des heures.
const PREFIX = 'leman.v2.';

function cacheSet(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ savedAt: Date.now(), value }));
  } catch { /* quota ou navigation privée : le cache est un bonus, pas une dépendance */ }
}

function cacheGet(key, maxAgeMs = Infinity) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const { savedAt, value } = JSON.parse(raw);
    return Date.now() - savedAt > maxAgeMs ? null : value;
  } catch {
    return null;
  }
}

/* ----------------------------------------------------------------- fetchers */

// Métadonnées des stations (nom, cours d'eau, coordonnées) : stables, cachées une semaine.
const geolocated = (meta) => Object.values(meta).filter((m) => m.lat != null).length;

async function fetchStationMeta() {
  const cached = cacheGet('stationMeta', CFG.metaCacheMs);
  if (cached) {
    // Journalisé même depuis le cache : l'absence de cette ligne masquait le fait
    // que des métadonnées sans coordonnées restaient en place des jours.
    note('métadonnées (cache)', geolocated(cached) > 0,
      `${Object.keys(cached).length} stations, ${geolocated(cached)} géolocalisées`);
    return cached;
  }

  for (const path of ['/locations', '/stations']) {
    try {
      const raw = await getJSON(urlStationMeta(path));
      const meta = parseStationMeta(raw);
      if (meta) {
        cacheSet('stationMeta', meta);
        const located = geolocated(meta);
        note('existenz' + path, located > 0,
          `${Object.keys(meta).length} stations, ${located} géolocalisées`);
        return meta;
      }
      // Réponse reçue mais illisible : le nombre d'entrées lues situe le problème.
      note('existenz' + path, false,
        `aucune station exploitable sur ${asArray(raw).length} entrée(s) — clés : ${Object.keys(raw || {}).slice(0, 6).join(', ') || '∅'}`);
    } catch (err) {
      note('existenz' + path, false, err.message);
    }
  }
  return null;
}

async function fetchMeasuredStations() {
  const raw = await getJSON(urlLatestTemperature());
  const received = asArray(raw).length;
  const meta = await fetchStationMeta();
  const list = parseMeasuredStations(raw, meta);
  note('existenz/latest', list.length > 0,
    `${list.length} station(s) sur le Léman, ${received} enregistrement(s) reçu(s)`);
  return list;
}

// Le modèle passe d'abord par l'instantané précalculé : Alplakes ne renvoie pas
// d'en-tête CORS, donc l'appel direct n'aboutit que hors navigateur. Il reste
// tenté en second, au cas où (usage local, ou CORS ouvert un jour).
async function fetchModelSeries(spot) {
  try {
    const raw = await getJSON(urlModelSnapshot());
    const points = parseSnapshot(raw, spot.key);
    if (!points.length) throw new Error(`aucun point pour ${spot.key}`);
    const ageH = Math.round((snapshotAge(raw) ?? 0) / 3600000);
    note('instantané', true, `${spot.name} : ${points.length} points, calculé il y a ${ageH} h`);
    return { points, origin: 'snapshot', age: snapshotAge(raw) };
  } catch (err) {
    note('instantané', false, err.message);
  }

  const now = Date.now();
  const url = urlModelPoint(
    spot,
    new Date(now - CFG.pastDays * 86400000),
    new Date(now + CFG.futureDays * 86400000),
  );
  const points = parseSeries(await getJSON(url));
  if (!points.length) throw new Error('série vide');
  note('alplakes direct', true, `${spot.name} : ${points.length} points`);
  return { points, origin: 'live', age: 0 };
}

/* ----------------------------------------------------------------- rendu UI */

function renderSpots() {
  $('places').replaceChildren(...SPOTS.map((spot) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = spot.name;
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => selectSpot(spot));
    return b;
  }));
}

function markSelectedChip() {
  [...$('places').children].forEach((b, i) => {
    const selected = SPOTS[i].key === currentSpot.key;
    b.setAttribute('aria-selected', String(selected));
    if (selected) b.scrollIntoView({ inline: 'center', block: 'nearest' });
  });
}

function renderHero({ value, at, kind, label }) {
  const { adj, aside, band } = mood(value);

  // La couleur du fond suit la température : elle informe avant le chiffre.
  document.body.dataset.band = band;
  $('adjective').textContent = adj;
  $('aside').textContent = aside;
  $('value').textContent = formatTemp(value);

  $('readoutPlace').textContent = currentSpot.name;
  $('readoutSource').textContent = value == null ? label : shortSource(label, at);

  document.querySelector('.readout').classList.toggle('stale', value != null && isStale(at));

  // Le minuteur se règle sur la valeur affichée : une minute par degré.
  setWaterTemperature(value);
}

function renderStations(list) {
  const ul = $('stations');
  if (!list || !list.length) {
    const li = document.createElement('li');
    li.className = 'st-empty';
    li.textContent = 'Mesures officielles indisponibles (voir le diagnostic).';
    ul.replaceChildren(li);
    return;
  }
  ul.replaceChildren(...list.map((s) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.className = 'st-name';
    name.textContent = s.name;

    const sub = document.createElement('span');
    sub.className = 'st-sub';
    sub.textContent = [s.water, formatAge(s.at)].filter(Boolean).join(' · ');
    name.append(sub);

    const val = document.createElement('span');
    val.className = 'st-val';
    val.textContent = `${formatTemp(s.value)} °C`;

    li.append(name, val);
    return li;
  }));
}

function renderChart(points) {
  const box = $('chart');
  const W = 320, H = 150, padL = 26, padR = 8, padT = 12, padB = 20;

  if (!points || points.length < 2) {
    box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Courbe indisponible">`
      + `<text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">Courbe indisponible</text>`
      + '</svg>';
    return;
  }

  const values = points.map((p) => p.value);
  const t0 = points[0].at.getTime();
  const t1 = points[points.length - 1].at.getTime();
  const lo = Math.floor(Math.min(...values) - 0.6);
  const hi = Math.ceil(Math.max(...values) + 0.6);
  const x = (t) => padL + ((t - t0) / Math.max(1, t1 - t0)) * (W - padL - padR);
  const y = (v) => padT + (1 - (v - lo) / Math.max(0.5, hi - lo)) * (H - padT - padB);
  const path = (pts) => pts
    .map((p, i) => `${i ? 'L' : 'M'}${x(p.at.getTime()).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join('');

  const now = Date.now();
  const past = points.filter((p) => p.at.getTime() <= now);
  const future = points.filter((p) => p.at.getTime() >= now);

  // Pas de grille : une ligne de base, et les extrêmes annotés au plus près.
  const extremes = [
    { v: Math.max(...values), anchor: 'start' },
    { v: Math.min(...values), anchor: 'start' },
  ].map(({ v }) => `<text class="axis" x="0" y="${(y(v) + 3).toFixed(1)}">`
    + `${v.toFixed(1).replace('.', ',')}°</text>`).join('');

  const baseline = `<line class="base" x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}"/>`;

  const days = [];
  for (const d = new Date(t0); d.getTime() <= t1; d.setDate(d.getDate() + 1)) {
    const midnight = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (midnight <= t0 || midnight >= t1) continue;
    days.push(`<text class="axis" x="${x(midnight).toFixed(1)}" y="${H - 6}" text-anchor="middle">`
      + `${new Date(midnight).toLocaleDateString('fr-CH', { weekday: 'short' }).replace('.', '').toUpperCase()}</text>`);
  }

  const marker = past.length ? past[past.length - 1] : points[0];

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"`
    + ` aria-label="Température de l'eau sur ${CFG.pastDays + CFG.futureDays} jours">`
    + baseline + extremes + days.join('')
    + (past.length > 1 ? `<path class="line" d="${path(past)}"/>` : '')
    + (future.length > 1 ? `<path class="line line-future" d="${path(future)}"/>` : '')
    + `<circle class="now" cx="${x(marker.at.getTime()).toFixed(1)}" cy="${y(marker.value).toFixed(1)}" r="3.5"/>`
    + '</svg>';
}

/* ----------------------------------------------------------- orchestration */

const reviveSeries = (raw) => (raw || [])
  .map((p) => ({ at: new Date(p.at), value: p.value }))
  .filter((p) => !isNaN(p.at.getTime()) && isFinite(p.value));

function paint(stations, series, hint = 'modèle Eawag') {
  renderStations(stations);
  renderChart(series);
  renderHero(bestReading(currentSpot, stations, series));
  $('chartHint').textContent = hint;
}

async function refresh({ silent = false } = {}) {
  if (refreshing) return;
  refreshing = true;
  $('refresh').classList.add('busy');

  const [stationsRes, seriesRes] = await Promise.allSettled([
    fetchMeasuredStations(),
    fetchModelSeries(currentSpot),
  ]);

  let stations;
  if (stationsRes.status === 'fulfilled') {
    stations = stationsRes.value;
    cacheSet('stations', stations);
  } else {
    note('existenz/latest', false, stationsRes.reason?.message || 'échec');
    stations = cacheGet('stations');
  }

  let series;
  let hint = 'modèle Eawag';
  if (seriesRes.status === 'fulfilled') {
    const { points, origin, age } = seriesRes.value;
    series = points;
    // Un instantané qui ne se rafraîchit plus doit se voir : la CI est en panne.
    const ageH = Math.round((age || 0) / 3600000);
    hint = origin === 'live' ? 'modèle Eawag, direct'
      : ageH >= 6 ? `modèle Eawag, il y a ${ageH} h`
      : 'modèle Eawag';
    cacheSet(`series.${currentSpot.key}`,
      series.map((p) => ({ at: p.at.toISOString(), value: p.value })));
  } else {
    note('modèle', false, seriesRes.reason?.message || 'échec');
    series = reviveSeries(cacheGet(`series.${currentSpot.key}`));
    hint = series.length ? 'dernière valeur en cache' : 'indisponible';
  }

  paint(stations, series, hint);

  if (!silent && stationsRes.status === 'rejected' && seriesRes.status === 'rejected') {
    toast(navigator.onLine ? 'Sources injoignables' : 'Hors ligne — données en cache');
  }

  $('refresh').classList.remove('busy');
  refreshing = false;
}

// Peint immédiatement la dernière donnée connue ; indique si elle existait.
function paintFromCache() {
  const stations = cacheGet('stations');
  const series = reviveSeries(cacheGet(`series.${currentSpot.key}`));
  if (!stations && !series.length) return false;
  paint(stations, series, 'dernière valeur en cache');
  return true;
}

function selectSpot(spot, direction = null) {
  if (spot.key === currentSpot.key) return;
  currentSpot = spot;
  cacheSet('spot', spot.key);
  markSelectedChip();
  paintFromCache();
  refresh({ silent: true });
  if (direction) animateSwap(direction);
}

// Le contenu entre depuis le côté d'où vient le geste : sans ce repère visuel,
// un balayage ne se distingue pas d'un rafraîchissement.
function animateSwap(direction) {
  const cls = direction === 'next' ? 'enter-next' : 'enter-prev';
  for (const el of document.querySelectorAll('.statement, .readout')) {
    el.classList.remove('enter-next', 'enter-prev');
    // Forcer un recalcul relance l'animation même sur deux balayages successifs.
    void el.offsetWidth;
    el.classList.add(cls);
    el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
  }
}

function moveSpot(direction) {
  const from = SPOTS.findIndex((s) => s.key === currentSpot.key);
  const to = nextIndex(from, direction, SPOTS.length);
  if (to !== from) selectSpot(SPOTS[to], direction);
}

/* ------------------------------------------------------------ balayage */

// Balayage horizontal sur le premier écran. Événements pointeur : ils couvrent
// le doigt comme la souris, et le navigateur émet pointercancel dès qu'il prend
// le geste pour un défilement — ce qui suffit à ne jamais lui disputer la page.
function enableSwipe() {
  const screen = document.querySelector('.screen');
  let start = null;

  screen.addEventListener('pointerdown', (e) => {
    // Le sélecteur de lieux défile horizontalement pour son propre compte,
    // et les commandes gardent la priorité sur le geste.
    if (e.target.closest('.places, button, a')) return;
    if (!e.isPrimary) return;
    start = { x: e.clientX, y: e.clientY, at: Date.now() };
  });

  const finish = (e) => {
    if (!start) return;
    const decision = swipeDecision(e.clientX - start.x, e.clientY - start.y, Date.now() - start.at);
    start = null;
    if (decision) moveSpot(decision);
  };

  screen.addEventListener('pointerup', finish);
  screen.addEventListener('pointercancel', () => { start = null; });
  screen.addEventListener('pointerleave', () => { start = null; });

  // Au clavier, les flèches font le même travail.
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'ArrowRight') moveSpot('next');
    else if (e.key === 'ArrowLeft') moveSpot('prev');
  });
}

/* ------------------------------------------------------ iOS & cycle de vie */

function maybeShowInstallHint() {
  const standalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  const iOS = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (standalone || !iOS || cacheGet('installHintDismissed')) return;

  $('install').hidden = false;
  $('installClose').addEventListener('click', () => {
    $('install').hidden = true;
    cacheSet('installHintDismissed', true);
  });
}

function init() {
  currentSpot = SPOTS.find((s) => s.key === cacheGet('spot')) || SPOTS[0];

  renderSpots();
  markSelectedChip();
  const hadCache = paintFromCache();
  // Au premier lancement sans cache, un échec total mérite d'être signalé.
  refresh({ silent: hadCache });

  $('refresh').addEventListener('click', () => refresh());

  // Sur iOS l'app reste ouverte des jours : on rafraîchit au retour au premier plan.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh({ silent: true });
  });
  window.addEventListener('online', () => refresh({ silent: true }));
  setInterval(() => { if (!document.hidden) refresh({ silent: true }); }, CFG.autoRefreshMs);

  enableSwipe();
  initBath();
  maybeShowInstallHint();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js')
      .catch((err) => note('service worker', false, err.message));
  }
}

init();
