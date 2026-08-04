// Couche données : construction des URL, analyse des réponses, choix de la
// valeur à afficher. Aucun accès au DOM ni au réseau ici — ce module est
// importable tel quel par Node, ce qui permet de le tester (tools/test-parsers.mjs).

export const CFG = {
  existenz: 'https://api.existenz.ch/apiv1/hydro',
  alplakes: 'https://alplakes-api.eawag.ch',
  model: 'delft3d-flow',
  lake: 'geneva',
  depth: 1,              // profondeur en mètres pour la « température de surface »
  pastDays: 5,
  futureDays: 2,
  nearStationKm: 12,     // au-delà, une station cesse de représenter le lieu choisi
  staleAfterMs: 6 * 3600 * 1000,
  timeoutMs: 12000,
  autoRefreshMs: 15 * 60 * 1000,
  // Emprise du Léman, volontairement large : sert à isoler les stations du lac.
  bbox: { minLat: 46.15, maxLat: 46.62, minLon: 6.05, maxLon: 7.02 },
};

// Points pris au large des localités : le modèle n'a de valeur que sur l'eau.
export const SPOTS = [
  { key: 'geneve',    name: 'Genève',      sub: 'Rade / Pâquis', lat: 46.2135, lon: 6.1560 },
  { key: 'nyon',      name: 'Nyon',        sub: '',              lat: 46.3900, lon: 6.2450 },
  { key: 'morges',    name: 'Morges',      sub: '',              lat: 46.4980, lon: 6.4980 },
  { key: 'lausanne',  name: 'Lausanne',    sub: 'Ouchy',         lat: 46.4950, lon: 6.6300 },
  { key: 'vevey',     name: 'Vevey',       sub: '',              lat: 46.4520, lon: 6.8420 },
  { key: 'montreux',  name: 'Montreux',    sub: '',              lat: 46.4250, lon: 6.9050 },
  { key: 'bouveret',  name: 'Le Bouveret', sub: 'Haut-Lac',      lat: 46.3900, lon: 6.8900 },
  { key: 'evian',     name: 'Évian',       sub: '',              lat: 46.4050, lon: 6.5850 },
  { key: 'thonon',    name: 'Thonon',      sub: '',              lat: 46.3850, lon: 6.4750 },
  { key: 'yvoire',    name: 'Yvoire',      sub: '',              lat: 46.3800, lon: 6.3300 },
];

/* --------------------------------------------------------------- utilitaires */

// Les réponses des deux API n'ont pas de schéma stable et documenté au même
// niveau de détail : on lit les champs par tolérance plutôt que par supposition.
export function pick(obj, ...names) {
  for (const n of names) if (obj && obj[n] != null) return obj[n];
  return undefined;
}

export function asArray(payload) {
  if (Array.isArray(payload)) return payload;
  const inner = pick(payload, 'payload', 'data', 'results', 'stations', 'locations');
  if (Array.isArray(inner)) return inner;

  // Certaines réponses indexent les enregistrements par identifiant au lieu de
  // les lister. La clé porte alors le numéro de station : on la réinjecte, sans
  // quoi l'enregistrement devient inexploitable.
  const map = (inner && typeof inner === 'object') ? inner
    : (payload && typeof payload === 'object') ? payload : null;
  if (!map) return [];

  return Object.entries(map)
    .filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v))
    .map(([key, v]) => (pick(v, 'loc', 'id', 'station', 'nr', 'code', 'key') == null
      ? { loc: key, ...v }
      : v));
}

export function toDate(ts) {
  if (ts == null) return null;
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
  if (typeof ts === 'number') return new Date(ts < 1e12 ? ts * 1000 : ts);
  const d = new Date(ts);
  return isNaN(d.getTime()) ? null : d;
}

export function distanceKm(a, b) {
  const R = 6371;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const isStale = (date, now = Date.now()) =>
  !date || now - toDate(date).getTime() > CFG.staleAfterMs;

// Plage physiquement plausible pour l'eau d'un lac de plaine.
const plausible = (v) => isFinite(v) && v >= -2 && v <= 35;

/* ---------------------------------------------------------------------- URL */

export const urlStationMeta = (path) => `${CFG.existenz}${path}`;

export const urlLatestTemperature = () =>
  `${CFG.existenz}/latest?parameters=temperature&app=leman-pwa`;

// Alplakes attend des horodatages UTC au format YYYYMMDDHHMM.
export function stampUTC(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}`
       + `${p(date.getUTCHours())}00`;
}

export function urlModelPoint(spot, start, end) {
  return `${CFG.alplakes}/simulations/point/${CFG.model}/${CFG.lake}`
       + `/${stampUTC(start)}/${stampUTC(end)}/${CFG.depth}/${spot.lat}/${spot.lon}`;
}

/* ------------------------------------------------------------- analyse existenz */

export function parseStationMeta(raw) {
  const meta = {};
  for (const s of asArray(raw)) {
    const id = String(pick(s, 'loc', 'id', 'station', 'nr', 'code', 'key') ?? '');
    if (!id) continue;
    const lat = Number(pick(s, 'lat', 'latitude', 'wgs84lat', 'y'));
    const lon = Number(pick(s, 'lon', 'lng', 'longitude', 'wgs84lng', 'x'));
    meta[id] = {
      name: String(pick(s, 'name', 'label', 'title', 'loc_name') ?? id),
      water: String(pick(s, 'water', 'waterbody', 'water_body', 'river', 'lake') ?? ''),
      lat: isFinite(lat) ? lat : null,
      lon: isFinite(lon) ? lon : null,
    };
  }
  return Object.keys(meta).length ? meta : null;
}

const LEMAN_NAME = /l[ée]man|genfersee|lake\s*geneva|gen[eè]ve|geneva|rh[oô]ne/i;

// Retient les mesures de température d'eau situées sur le Léman (ou, à défaut de
// coordonnées, celles dont le nom désigne clairement le lac ou son émissaire).
export function parseMeasuredStations(raw, meta, bbox = CFG.bbox) {
  const out = [];
  for (const row of asArray(raw)) {
    const param = String(pick(row, 'parameter', 'param') ?? 'temperature');
    if (!/temp/i.test(param)) continue;

    const value = Number(pick(row, 'value', 'val', 'temperature'));
    if (!plausible(value)) continue;

    const id = String(pick(row, 'loc', 'location', 'station', 'id') ?? '');
    const m = (meta && meta[id]) || {};
    const name = String(pick(row, 'name', 'loc_name') ?? m.name ?? id ?? '');
    const water = m.water || String(pick(row, 'water', 'waterbody') ?? '');

    let coords = null;
    if (m.lat != null && m.lon != null) {
      const inBox = m.lat >= bbox.minLat && m.lat <= bbox.maxLat
                 && m.lon >= bbox.minLon && m.lon <= bbox.maxLon;
      if (!inBox) continue;
      coords = { lat: m.lat, lon: m.lon };
    } else if (!LEMAN_NAME.test(`${name} ${water}`)) {
      continue;
    }

    out.push({
      id,
      name: name || id,
      water,
      value,
      at: toDate(pick(row, 'timestamp', 'time', 'datetime', 'date')),
      coords,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return out;
}

/* ------------------------------------------------------------- analyse Alplakes */

// Retourne [{ at: Date, value: °C }] trié dans le temps.
export function parseSeries(raw) {
  const times = pick(raw, 'time', 'times', 'timestamps') || [];
  const vars = pick(raw, 'variables', 'variable') || {};
  const node = pick(vars, 'temperature', 'water_temperature', 'temp')
            ?? pick(raw, 'temperature', 'water_temperature');
  const values = Array.isArray(node) ? node : (pick(node, 'data', 'values') || []);

  const points = [];
  const n = Math.min(times.length, values.length);
  for (let i = 0; i < n; i++) {
    const at = toDate(times[i]);
    // Les trous du modèle arrivent en null / chaîne vide : Number() les rendrait 0.
    if (values[i] == null || values[i] === '') continue;
    let v = Number(values[i]);
    if (!at || !isFinite(v)) continue;
    if (v > 100) v -= 273.15;          // certaines sorties de modèle sont en kelvin
    if (!plausible(v)) continue;
    points.push({ at, value: v });
  }
  points.sort((a, b) => a.at - b.at);
  return points;
}

/* ------------------------------------------------------------------- lecture */

// Valeur mise en avant : une mesure proche et récente d'abord, sinon le modèle,
// sinon la mesure la plus proche même ancienne.
export function bestReading(spot, stations, series, now = Date.now()) {
  const near = (stations || [])
    .filter((s) => s.coords)
    .map((s) => ({ ...s, km: distanceKm(spot, s.coords) }))
    .sort((a, b) => a.km - b.km)[0];

  const asMeasure = (s) => ({
    value: s.value,
    at: toDate(s.at),
    kind: 'measured',
    label: `mesure · ${s.name}`,
  });

  if (near && near.km <= CFG.nearStationKm && !isStale(near.at, now)) return asMeasure(near);

  if (series && series.length) {
    const closest = series.reduce((a, b) =>
      Math.abs(b.at.getTime() - now) < Math.abs(a.at.getTime() - now) ? b : a);
    return { value: closest.value, at: closest.at, kind: 'model', label: 'modèle Eawag' };
  }

  if (near) return asMeasure(near);

  return { value: null, at: null, kind: 'error', label: 'indisponible' };
}

export function advice(t) {
  if (typeof t !== 'number' || !isFinite(t)) return '';
  if (t < 8)  return 'Glacial. Immersion très brève, jamais seul.';
  if (t < 12) return 'Très froid : quelques minutes tout au plus.';
  if (t < 15) return 'Froid, la respiration se coupe. Combinaison bienvenue.';
  if (t < 18) return 'Frais, mais ça se fait pour les habitués.';
  if (t < 21) return 'Baignade agréable, l’entrée reste vive.';
  if (t < 24) return 'Très bonne température pour nager.';
  return 'Eau chaude, comme une piscine.';
}
