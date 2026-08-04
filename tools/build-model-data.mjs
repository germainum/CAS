// Précalcule les séries du modèle Alplakes pour tous les lieux, côté serveur.
//
// L'API Alplakes ne renvoie pas d'en-tête CORS : une page web ne peut pas
// l'interroger directement. Ce script tourne donc dans la CI — où CORS n'existe
// pas — et dépose le résultat dans data/model.json, publié avec le site. L'app
// lit ensuite ce fichier depuis sa propre origine, sans requête bloquée.
//
// Usage : node tools/build-model-data.mjs [chemin de sortie]

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { CFG, SPOTS, parseSeries, stampUTC, urlModelPoint } from '../sources.js';

const OUT = process.argv[2] || 'data/model.json';

async function getJSON(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} sur ${url}`);
  return res.json();
}

// La simulation ne va pas au-delà d'une certaine date : demander plus loin
// renverrait une erreur. On lit donc la borne annoncée par l'API.
async function lakeEndDate() {
  try {
    const meta = await getJSON(`${CFG.alplakes}/simulations/metadata`);
    const models = Array.isArray(meta) ? meta : [meta];
    const lake = models
      .find((m) => m.model === CFG.model)?.lakes
      ?.find((l) => l.name === CFG.lake);
    if (!lake?.end_date) return null;
    // end_date est un jour ; on vise sa fin pour ne rien perdre de la prévision.
    const end = new Date(`${lake.end_date}T21:00:00Z`);
    return isNaN(end.getTime()) ? null : end;
  } catch (err) {
    console.warn(`métadonnées indisponibles (${err.message}), bornes par défaut`);
    return null;
  }
}

const now = Date.now();
const start = new Date(now - CFG.pastDays * 86400000);
const limit = await lakeEndDate();
let end = new Date(now + CFG.futureDays * 86400000);
if (limit && limit < end) {
  console.log(`prévision limitée par l'API au ${limit.toISOString()}`);
  end = limit;
}
if (end <= start) throw new Error('fenêtre temporelle vide : simulation trop ancienne ?');

const spots = {};
const failures = [];

for (const spot of SPOTS) {
  const url = urlModelPoint(spot, start, end);
  try {
    const points = parseSeries(await getJSON(url));
    if (!points.length) throw new Error('série vide après analyse');
    spots[spot.key] = {
      t: points.map((p) => p.at.toISOString()),
      v: points.map((p) => Math.round(p.value * 100) / 100),
    };
    const values = points.map((p) => p.value);
    console.log(`${spot.name.padEnd(12)} ${String(points.length).padStart(3)} points  `
      + `${Math.min(...values).toFixed(1)} → ${Math.max(...values).toFixed(1)} °C`);
  } catch (err) {
    failures.push(`${spot.key}: ${err.message}`);
    console.error(`${spot.name.padEnd(12)} ÉCHEC ${err.message}`);
  }
}

if (!Object.keys(spots).length) {
  console.error('\nAucun lieu récupéré — data/model.json ne sera pas écrit.');
  console.error(failures.join('\n'));
  process.exit(1);
}

const snapshot = {
  generatedAt: new Date().toISOString(),
  window: { start: stampUTC(start), end: stampUTC(end) },
  source: { api: CFG.alplakes, model: CFG.model, lake: CFG.lake, depth: CFG.depth },
  unit: 'degC',
  spots,
  ...(failures.length ? { failures } : {}),
};

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(snapshot)}\n`);

console.log(`\n${OUT} écrit : ${Object.keys(spots).length}/${SPOTS.length} lieux`
  + `${failures.length ? `, ${failures.length} en échec` : ''}`);
