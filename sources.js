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
  // Les métadonnées de stations changent rarement, mais une version incomplète ne
  // doit pas s'installer pour une semaine : un jour suffit à limiter les dégâts.
  metaCacheMs: 24 * 3600 * 1000,
  timeoutMs: 12000,
  autoRefreshMs: 15 * 60 * 1000,
  // Emprise du Léman, volontairement large : sert à isoler les stations du lac.
  bbox: { minLat: 46.15, maxLat: 46.62, minLon: 6.05, maxLon: 7.02 },
};

// Points pris au large des localités : le modèle n'a de valeur que sur l'eau.
export const SPOTS = [
  { key: 'geneve',    name: 'Genève',      sub: 'Rade / Pâquis', lat: 46.2225, lon: 6.1589 },
  { key: 'nyon',      name: 'Nyon',        sub: '',              lat: 46.3780, lon: 6.2650 },
  { key: 'morges',    name: 'Morges',      sub: '',              lat: 46.4980, lon: 6.4980 },
  { key: 'lausanne',  name: 'Lausanne',    sub: 'Ouchy',         lat: 46.4950, lon: 6.6300 },
  { key: 'vevey',     name: 'Vevey',       sub: '',              lat: 46.4520, lon: 6.8420 },
  { key: 'montreux',  name: 'Montreux',    sub: '',              lat: 46.4250, lon: 6.9050 },
  { key: 'bouveret',  name: 'Le Bouveret', sub: 'Haut-Lac',      lat: 46.4035, lon: 6.8900 },
  { key: 'evian',     name: 'Évian',       sub: '',              lat: 46.4155, lon: 6.5850 },
  { key: 'thonon',    name: 'Thonon',      sub: '',              lat: 46.3925, lon: 6.4687 },
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

// Lieu proposé le plus proche d'une position, et sa distance. Sert à ouvrir
// l'app sur l'eau où l'on se trouve, plutôt que sur un choix arbitraire.
export function nearestSpot(coords, spots = SPOTS) {
  if (!coords || !isFinite(coords.lat) || !isFinite(coords.lon) || !spots.length) return null;
  return spots
    .map((spot) => ({ spot, km: distanceKm(coords, spot) }))
    .reduce((a, b) => (b.km < a.km ? b : a));
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

// Instantané précalculé par la CI, servi depuis la même origine que la page.
// Chemin relatif : l'app fonctionne aussi sous un sous-répertoire (GitHub Pages).
export const urlModelSnapshot = () => 'data/model.json';

/* ------------------------------------------------- analyse de l'instantané */

// Extrait la série d'un lieu de l'instantané : { t: [...ISO], v: [...°C] }.
export function parseSnapshot(raw, spotKey) {
  const entry = pick(raw?.spots, spotKey);
  const times = pick(entry, 't', 'time', 'times') || [];
  const values = pick(entry, 'v', 'values', 'data') || [];

  const points = [];
  const n = Math.min(times.length, values.length);
  for (let i = 0; i < n; i++) {
    const at = toDate(times[i]);
    if (values[i] == null || values[i] === '') continue;
    const v = Number(values[i]);
    if (!at || !plausible(v)) continue;
    points.push({ at, value: v });
  }
  points.sort((a, b) => a.at - b.at);
  return points;
}

// Âge de l'instantané, pour signaler une CI en panne plutôt qu'afficher
// silencieusement des valeurs figées.
export function snapshotAge(raw, now = Date.now()) {
  const at = toDate(raw?.generatedAt);
  return at ? now - at.getTime() : null;
}

/* ------------------------------------------------------------- analyse existenz */

export function parseStationMeta(raw) {
  const meta = {};
  for (const row of asArray(raw)) {
    // existenz imbrique les informations utiles dans `details`. Attention : le
    // champ `id` de premier niveau n'est qu'un rang (1, 2, 3…), pas le numéro de
    // station — celui-ci est `details.id`, et se retrouve aussi dans `name`.
    const d = pick(row, 'details', 'station', 'properties') || row;

    const id = String(pick(d, 'id', 'loc', 'nr', 'code')
      ?? pick(row, 'loc', 'name', 'key') ?? '');
    if (!id) continue;

    const lat = Number(pick(d, 'lat', 'latitude', 'wgs84lat', 'y'));
    const lon = Number(pick(d, 'lon', 'lng', 'longitude', 'wgs84lng', 'x'));

    meta[id] = {
      name: String(pick(d, 'name', 'label', 'title', 'loc_name') ?? id),
      water: String(pick(d, 'water-body-name', 'water', 'waterbody', 'water_body',
        'river', 'lake') ?? ''),
      kind: String(pick(d, 'water-body-type', 'type') ?? ''),
      lat: isFinite(lat) ? lat : null,
      lon: isFinite(lon) ? lon : null,
    };
  }
  return Object.keys(meta).length ? meta : null;
}

const LEMAN_NAME = /l[ée]man|genfersee|lake\s*geneva/i;

// Une station de rivière dans l'emprise du lac ne mesure pas le lac : à Porte du
// Scex, le Rhône amont est à 10 °C en plein été — de l'eau de glacier. Seule
// exception, l'exutoire : l'eau qui sort du lac EST de l'eau du lac. Les stations
// concernées sont donc nommées une à une, plutôt que déduites d'une géographie
// que les données ne portent pas.
const LAKE_OUTFLOWS = {
  2606: 'Genève, sortie du lac',   // Rhône, Halle de l'Île
};

// Vrai si la station mesure de l'eau du lac : pleine eau, ou exutoire nommé.
function measuresLakeWater(id, meta) {
  if (LAKE_OUTFLOWS[id]) return true;
  if (/river|fluss|rivi[eè]re/i.test(meta?.kind ?? '')) return false;
  return LEMAN_NAME.test(`${meta?.name ?? ''} ${meta?.water ?? ''}`);
}

// Retient les seules mesures de température représentatives du Léman.
export function parseMeasuredStations(raw, meta, bbox = CFG.bbox) {
  const out = [];
  for (const row of asArray(raw)) {
    // existenz abrège : `par` pour le paramètre, `val` pour la valeur.
    const param = String(pick(row, 'par', 'parameter', 'param') ?? 'temperature');
    if (!/temp/i.test(param)) continue;

    const value = Number(pick(row, 'val', 'value', 'temperature'));
    if (!plausible(value)) continue;

    const id = String(pick(row, 'loc', 'location', 'station', 'id') ?? '');
    const m = (meta && meta[id]) || {};
    const water = m.water || String(pick(row, 'water', 'waterbody') ?? '');
    const name = LAKE_OUTFLOWS[id]
      ?? String(pick(row, 'name', 'loc_name') ?? m.name ?? id ?? '');

    // La nature de l'eau primait sur la géographie : une rivière glaciaire
    // traversant l'emprise du lac était retenue comme s'il s'agissait du lac.
    if (!measuresLakeWater(id, { ...m, name: m.name ?? name })) continue;

    let coords = null;
    if (m.lat != null && m.lon != null) {
      const inBox = m.lat >= bbox.minLat && m.lat <= bbox.maxLat
                 && m.lon >= bbox.minLon && m.lon <= bbox.maxLon;
      if (!inBox) continue;
      coords = { lat: m.lat, lon: m.lon };
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

// L'affirmation portée par la page : un adjectif, une remarque sèche, et la
// bande de couleur qui teinte le fond. « band » pilote le dégradé.
const MOODS = [
  { max: 8,        band: 'cold',  adj: 'glaciale',   aside: 'Trempez un orteil, vous serez convaincu.' },
  { max: 12,       band: 'cold',  adj: 'mordante',   aside: 'La respiration se coupe dans les cinq premières secondes.' },
  { max: 15,       band: 'cool',  adj: 'froide',     aside: 'Les habitués y vont. Pas longtemps.' },
  { max: 18,       band: 'fresh', adj: 'fraîche',    aside: 'Vive à l’entrée, supportable ensuite.' },
  { max: 21,       band: 'good',  adj: 'bonne',      aside: 'Aucune excuse valable.' },
  { max: 24,       band: 'good',  adj: 'excellente', aside: 'C’est le moment.' },
  { max: Infinity, band: 'warm',  adj: 'chaude',     aside: 'Autant dire une piscine.' },
];

const UNKNOWN = {
  band: 'unknown',
  adj: 'inconnue',
  aside: 'Aucune source ne répond pour l’instant.',
};

/* ------------------------------------------------------------ carte du lac */

// Contour du Léman, en [lat, lon]. Extrait de Natural Earth 10m (domaine
// public), converti depuis le GeoJSON d'origine en [lon, lat]. Trente-huit
// points : la silhouette est juste, mais volontairement lissée près des rives —
// ce n'est pas une carte de navigation.
export const LAKE_OUTLINE = [
  [46.4587, 6.8712], [46.4419, 6.9165], [46.4231, 6.9354], [46.4043, 6.9139],
  [46.4025, 6.8677], [46.4231, 6.6972], [46.4093, 6.4994], [46.4063, 6.4947],
  [46.3922, 6.4841], [46.3890, 6.4791], [46.3857, 6.4647], [46.3716, 6.4329],
  [46.3684, 6.4176], [46.3654, 6.4082], [46.3513, 6.3937], [46.3480, 6.3837],
  [46.3507, 6.3761], [46.3716, 6.3555], [46.3739, 6.2948], [46.3124, 6.2371],
  [46.2388, 6.1830], [46.2047, 6.1332], [46.2132, 6.1362], [46.2203, 6.1403],
  [46.2265, 6.1459], [46.2312, 6.1532], [46.2689, 6.1600], [46.3001, 6.1765],
  [46.4511, 6.3184], [46.4614, 6.3346], [46.4673, 6.3528], [46.4731, 6.4191],
  [46.4796, 6.4358], [46.5132, 6.4950], [46.5176, 6.5109], [46.5223, 6.5977],
  [46.5194, 6.6201], [46.4784, 6.7844]
];

// Projette des points [lat, lon] dans une boîte SVG. Équirectangulaire corrigée
// par le cosinus de la latitude médiane : à cette échelle, l'écart avec une
// projection conforme est invisible, et les proportions du lac sont justes.
export function projectPoints(points, { width, height, pad = 8 }) {
  if (!points.length) return { points: [], project: () => [0, 0] };

  const lats = points.map((p) => p[0]);
  const lons = points.map((p) => p[1]);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kx = Math.cos((latMid * Math.PI) / 180);

  const xs = lons.map((lon) => lon * kx);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...lats), maxY = Math.max(...lats);

  // Une seule échelle pour les deux axes : le lac ne doit pas être déformé.
  const scale = Math.min((width - 2 * pad) / (maxX - minX), (height - 2 * pad) / (maxY - minY));
  const offX = (width - (maxX - minX) * scale) / 2;
  const offY = (height - (maxY - minY) * scale) / 2;

  const project = (lat, lon) => [
    offX + (lon * kx - minX) * scale,
    // Latitude croissante vers le nord, y croissant vers le bas : on inverse.
    offY + (maxY - lat) * scale,
  ];

  return { points: points.map(([lat, lon]) => project(lat, lon)), project, scale };
}

// Test du point dans le polygone, par lancer de rayon. Sert à vérifier qu'aucun
// lieu proposé n'est posé sur la terre ferme — le modèle n'y répondrait pas.
export function pointInPolygon(lat, lon, polygon = LAKE_OUTLINE) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [latI, lonI] = polygon[i];
    const [latJ, lonJ] = polygon[j];
    const crosses = (lonI > lon) !== (lonJ > lon)
      && lat < latI + ((lon - lonI) / (lonJ - lonI)) * (latJ - latI);
    if (crosses) inside = !inside;
  }
  return inside;
}

// Température courante de chaque lieu dans l'instantané : de quoi comparer les
// lieux entre eux sur la carte, toutes valeurs issues de la même source.
export function snapshotCurrentTemps(raw, now = Date.now()) {
  const out = {};
  for (const key of Object.keys(raw?.spots ?? {})) {
    const points = parseSnapshot(raw, key);
    if (!points.length) continue;
    const closest = points.reduce((a, b) =>
      Math.abs(b.at.getTime() - now) < Math.abs(a.at.getTime() - now) ? b : a);
    out[key] = closest.value;
  }
  return out;
}

/* ---------------------------------------------------------------- gestes */

export const SWIPE = {
  minX: 45,        // en deçà, c'est une touche, pas un balayage
  ratio: 1.6,      // le geste doit être franchement horizontal
  quickMs: 900,    // au-delà, il faut une amplitude plus nette
  longX: 90,
};

// Décide si un déplacement de pointeur est un balayage, et dans quel sens.
// Renvoie 'next', 'prev' ou null. Un geste vertical n'est jamais un balayage :
// c'est le défilement de la page, qui doit rester intact.
export function swipeDecision(dx, dy, dt) {
  if (Math.abs(dx) < SWIPE.minX) return null;
  if (Math.abs(dx) < Math.abs(dy) * SWIPE.ratio) return null;
  if (dt > SWIPE.quickMs && Math.abs(dx) < SWIPE.longX) return null;
  return dx < 0 ? 'next' : 'prev';
}

// Index atteint depuis `from` : borné aux extrémités plutôt que circulaire, pour
// que le premier et le dernier lieu restent des repères.
export function nextIndex(from, direction, total) {
  const step = direction === 'next' ? 1 : direction === 'prev' ? -1 : 0;
  return Math.min(total - 1, Math.max(0, from + step));
}

/* ------------------------------------------------------------ bain froid */

// Règle d'usage en eau froide : une minute d'immersion par degré. C'est un
// PLAFOND, jamais un objectif — sortir plus tôt est toujours la bonne décision.
// Au-delà de 18 °C la règle perd son sens : ce n'est plus un bain froid, d'où le
// plafonnement à 20 minutes plutôt qu'une extrapolation absurde.
export const BATH_MAX_MINUTES = 20;
export const BATH_COLD_BELOW = 18;

export function bathPlan(t) {
  if (typeof t !== 'number' || !isFinite(t)) return null;
  const raw = Math.max(1, Math.round(t));
  return {
    minutes: Math.min(raw, BATH_MAX_MINUTES),
    capped: raw > BATH_MAX_MINUTES,
    cold: t < BATH_COLD_BELOW,
    temp: t,
  };
}

// Découpage d'une immersion. Les seuils suivent la durée totale : sur trois
// minutes, une phase d'entrée d'une minute entière serait disproportionnée.
export function bathPhase(elapsedSec, totalSec) {
  if (!(totalSec > 0)) return { key: 'idle', label: '', hint: '' };
  if (elapsedSec >= totalSec) {
    return { key: 'done', label: 'Sors de l’eau', hint: 'Durée conseillée atteinte.' };
  }
  const edge = Math.min(60, Math.max(15, totalSec * 0.25));
  if (elapsedSec < edge) {
    return {
      key: 'shock',
      label: 'Respire lentement',
      hint: 'De grandes inspirations lentes pour contrer le choc thermique.',
    };
  }
  if (totalSec - elapsedSec <= edge) {
    return { key: 'exit', label: 'Prépare ta sortie', hint: 'Rapproche-toi du bord.' };
  }
  return { key: 'steady', label: 'Reste près du bord', hint: 'Souffle régulier, épaules relâchées.' };
}

// Respiration guidée : quatre secondes d'inspiration, six d'expiration. Le
// rythme allongé à l'expiration est ce qui calme la réponse au choc thermique.
export const BREATH_IN = 4;
export const BREATH_OUT = 6;

export function breathCue(elapsedSec) {
  const cycle = BREATH_IN + BREATH_OUT;
  const t = ((elapsedSec % cycle) + cycle) % cycle;   // robuste aux valeurs négatives
  return t < BREATH_IN
    ? { phase: 'in', word: 'Inspirez', progress: t / BREATH_IN, seconds: Math.ceil(BREATH_IN - t) }
    : { phase: 'out', word: 'Expirez', progress: (t - BREATH_IN) / BREATH_OUT, seconds: Math.ceil(cycle - t) };
}

// Tendance sur vingt-quatre heures : la valeur du modèle la plus proche de
// maintenant moins celle de la veille. Dit si le lac se réchauffe, ce qu'un
// chiffre isolé ne dit pas. `null` quand la série ne remonte pas assez loin —
// sans ce garde-fou, le point le plus ancien disponible ferait office de veille
// et l'écart annoncé n'aurait aucun rapport avec vingt-quatre heures.
export function trend(points, now = Date.now(), spanMs = 24 * 3600 * 1000) {
  const closest = (t) => (points || []).reduce(
    (best, p) => (!best || Math.abs(p.at.getTime() - t) < Math.abs(best.at.getTime() - t) ? p : best),
    null,
  );
  const then = closest(now - spanMs);
  const here = closest(now);
  if (!then || !here) return null;
  if (Math.abs(then.at.getTime() - (now - spanMs)) > spanMs / 4) return null;
  if (Math.abs(here.at.getTime() - now) > spanMs / 4) return null;
  return here.value - then.value;
}

export function formatClock(totalSec) {
  const s = Math.max(0, Math.round(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function mood(t) {
  if (typeof t !== 'number' || !isFinite(t)) return UNKNOWN;
  return MOODS.find((m) => t < m.max) ?? MOODS[MOODS.length - 1];
}
