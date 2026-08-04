// Vérifie les API amont depuis une machine qui a accès au réseau :
//   node tools/check-sources.mjs
// Pour chaque endpoint : code HTTP, en-tête CORS, et résultat des analyseurs
// réellement utilisés par l'app. Utile pour diagnostiquer une panne d'affichage.

import {
  CFG, SPOTS, bestReading, parseMeasuredStations, parseSeries, parseStationMeta,
  urlLatestTemperature, urlModelPoint, urlStationMeta,
} from '../sources.js';

const ok = (s) => `\x1b[32m${s}\x1b[0m`;
const bad = (s) => `\x1b[31m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

async function probe(label, url) {
  process.stdout.write(`\n${label}\n${dim(url)}\n`);
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', Origin: 'https://example.org' },
      signal: AbortSignal.timeout(CFG.timeoutMs),
    });
    const text = await res.text();
    const cors = res.headers.get('access-control-allow-origin');
    console.log(`  ${res.ok ? ok(`HTTP ${res.status}`) : bad(`HTTP ${res.status}`)}`
      + `  ${Date.now() - started} ms  ${text.length} octets`
      + `  CORS: ${cors ? ok(cors) : bad('absent — le navigateur bloquera')}`);
    if (!res.ok) {
      console.log(dim(`  corps : ${text.slice(0, 200)}`));
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      console.log(bad('  réponse non JSON'), dim(text.slice(0, 200)));
      return null;
    }
  } catch (err) {
    console.log(`  ${bad('échec')} ${err.message}`);
    return null;
  }
}

const spot = SPOTS.find((s) => s.key === (process.argv[2] || 'lausanne')) || SPOTS[0];
console.log(`Lieu testé : ${spot.name} (${spot.lat}, ${spot.lon})`);

// 1. Métadonnées des stations (deux chemins possibles selon la version de l'API).
let meta = null;
for (const path of ['/locations', '/stations']) {
  const raw = await probe(`existenz.ch — métadonnées ${path}`, urlStationMeta(path));
  meta = parseStationMeta(raw);
  if (meta) {
    const withCoords = Object.values(meta).filter((m) => m.lat != null).length;
    console.log(`  ${ok('analysé')} ${Object.keys(meta).length} stations, ${withCoords} géolocalisées`);
    console.log(dim(`  exemple : ${JSON.stringify(Object.entries(meta)[0])}`));
    break;
  }
  if (raw) console.log(bad('  aucune station exploitable dans cette réponse'));
}

// 2. Dernières températures d'eau mesurées.
const latest = await probe('existenz.ch — dernières températures', urlLatestTemperature());
let stations = [];
if (latest) {
  stations = parseMeasuredStations(latest, meta);
  console.log(`  ${stations.length ? ok('analysé') : bad('analysé')} ${stations.length} station(s) sur le Léman`);
  for (const s of stations) {
    console.log(`    ${s.name.padEnd(34)} ${String(s.value).padStart(5)} °C  ${s.at?.toISOString() ?? '?'}`);
  }
  if (!stations.length) {
    console.log(dim(`  premier enregistrement brut : ${JSON.stringify((latest.payload ?? latest)[0])}`));
  }
}

// 3. Simulation du lac (historique + prévision) au point choisi.
const now = Date.now();
const modelUrl = urlModelPoint(
  spot,
  new Date(now - CFG.pastDays * 86400000),
  new Date(now + CFG.futureDays * 86400000),
);
const raw = await probe(`Alplakes / Eawag — simulation ${CFG.model}`, modelUrl);
let series = [];
if (raw) {
  series = parseSeries(raw);
  if (series.length) {
    const values = series.map((p) => p.value);
    console.log(`  ${ok('analysé')} ${series.length} points, `
      + `de ${series[0].at.toISOString()} à ${series[series.length - 1].at.toISOString()}`);
    console.log(`  min ${Math.min(...values).toFixed(1)} °C / max ${Math.max(...values).toFixed(1)} °C`);
  } else {
    console.log(bad('  série vide après analyse'));
    console.log(dim(`  clés de la réponse : ${Object.keys(raw).join(', ')}`));
    console.log(dim(`  extrait : ${JSON.stringify(raw).slice(0, 300)}`));
  }
}

// 4. Ce que l'app afficherait avec ces données.
const reading = bestReading(spot, stations, series);
console.log('\nAffichage résultant');
console.log(`  ${reading.value == null ? bad('aucune donnée') : ok(`${reading.value.toFixed(1)} °C`)}`
  + `  [${reading.label}]  ${reading.at?.toISOString() ?? ''}`);

process.exitCode = reading.value == null ? 1 : 0;
