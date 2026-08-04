// Tests de la couche données, sans réseau : node tools/test-parsers.mjs
// Chaque cas décrit une forme de réponse plausible des API amont, y compris
// dégradée (champs manquants, valeurs aberrantes, kelvin, station hors lac).

import assert from 'node:assert/strict';

import {
  CFG, SPOTS, advice, bestReading, distanceKm, isStale, parseMeasuredStations,
  parseSeries, parseStationMeta, stampUTC, toDate, urlModelPoint,
} from '../sources.js';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.error(`  ✗ ${name}\n    ${err.message}`);
    process.exitCode = 1;
  }
};

const NOW = Date.parse('2026-08-04T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

console.log('horodatages et géométrie');

test('stampUTC produit le format attendu par Alplakes', () => {
  assert.equal(stampUTC(new Date('2026-08-04T09:30:00Z')), '202608040900');
  assert.equal(stampUTC(new Date('2026-01-02T00:00:00Z')), '202601020000');
});

test("l'URL du modèle contient lac, modèle, profondeur et coordonnées", () => {
  const url = urlModelPoint(SPOTS[0], new Date('2026-08-01T00:00:00Z'), new Date('2026-08-06T00:00:00Z'));
  assert.match(url, /simulations\/point\/delft3d-flow\/geneva\/202608010000\/202608060000\/1\/46\.2135\/6\.156$/);
});

test('toDate accepte secondes, millisecondes, ISO et Date', () => {
  assert.equal(toDate(1785844800).toISOString(), '2026-08-04T12:00:00.000Z');
  assert.equal(toDate(1785844800000).toISOString(), '2026-08-04T12:00:00.000Z');
  assert.equal(toDate('2026-08-04T12:00:00Z').toISOString(), '2026-08-04T12:00:00.000Z');
  assert.equal(toDate(new Date(NOW)).getTime(), NOW);
  assert.equal(toDate('pas une date'), null);
  assert.equal(toDate(null), null);
});

test('distanceKm : Genève–Lausanne ≈ 50 km', () => {
  const km = distanceKm({ lat: 46.2044, lon: 6.1432 }, { lat: 46.5197, lon: 6.6323 });
  assert.ok(km > 45 && km < 55, `obtenu ${km.toFixed(1)} km`);
});

test('isStale : au-delà de six heures la donnée est périmée', () => {
  assert.equal(isStale(hoursAgo(1), NOW), false);
  assert.equal(isStale(hoursAgo(9), NOW), true);
  assert.equal(isStale(null, NOW), true);
});

console.log('\nmétadonnées de stations (existenz.ch)');

test('parseStationMeta lit une réponse enveloppée dans payload', () => {
  const meta = parseStationMeta({
    ok: true,
    payload: [
      { loc: '2027', name: 'Genève, Sécheron', water: 'Lac Léman', lat: 46.2205, lon: 6.1478 },
      { loc: '2606', name: 'Genève, Halle de l’Île', water: 'Rhône', lat: 46.2058, lon: 6.1435 },
    ],
  });
  assert.equal(Object.keys(meta).length, 2);
  assert.equal(meta['2027'].name, 'Genève, Sécheron');
  assert.equal(meta['2027'].water, 'Lac Léman');
  assert.ok(Math.abs(meta['2027'].lat - 46.2205) < 1e-9);
});

test('parseStationMeta accepte les noms de champs alternatifs', () => {
  const meta = parseStationMeta([
    { id: 2027, label: 'Sécheron', waterbody: 'Léman', latitude: '46.22', longitude: '6.15' },
  ]);
  assert.equal(meta['2027'].name, 'Sécheron');
  assert.equal(meta['2027'].lat, 46.22);
});

test('parseStationMeta renvoie null si rien d’exploitable', () => {
  assert.equal(parseStationMeta({ ok: false, payload: [] }), null);
  assert.equal(parseStationMeta(null), null);
});

console.log('\nmesures in situ (existenz.ch)');

const META = {
  2027: { name: 'Genève, Sécheron', water: 'Lac Léman', lat: 46.2205, lon: 6.1478 },
  2606: { name: 'Genève, Halle de l’Île', water: 'Rhône', lat: 46.2058, lon: 6.1435 },
  2033: { name: 'Ouchy', water: 'Lac Léman', lat: 46.5062, lon: 6.6266 },
  2135: { name: 'Bâle, Rhin', water: 'Rhein', lat: 47.5590, lon: 7.5900 },
};

const LATEST = {
  ok: true,
  payload: [
    { loc: '2027', parameter: 'temperature', timestamp: 1785844800, unit: '°C', value: 21.4 },
    { loc: '2606', parameter: 'temperature', timestamp: 1785844800, unit: '°C', value: 20.9 },
    { loc: '2033', parameter: 'temperature', timestamp: 1785844800, unit: '°C', value: 21.8 },
    { loc: '2135', parameter: 'temperature', timestamp: 1785844800, unit: '°C', value: 24.1 },
    { loc: '2027', parameter: 'level', timestamp: 1785844800, unit: 'm', value: 372.1 },
  ],
};

test('seules les stations du Léman sont retenues, Bâle est écartée', () => {
  const list = parseMeasuredStations(LATEST, META);
  assert.deepEqual(list.map((s) => s.id).sort(), ['2027', '2033', '2606']);
  assert.ok(!list.some((s) => s.name.includes('Bâle')));
});

test('les paramètres autres que la température sont ignorés', () => {
  const list = parseMeasuredStations(LATEST, META);
  assert.ok(list.every((s) => s.value < 30), 'un niveau de 372 m est passé pour une température');
});

test('les valeurs aberrantes sont rejetées', () => {
  const list = parseMeasuredStations({
    payload: [
      { loc: '2027', parameter: 'temperature', value: 999, timestamp: 1785844800 },
      { loc: '2033', parameter: 'temperature', value: null, timestamp: 1785844800 },
      { loc: '2606', parameter: 'temperature', value: 19.2, timestamp: 1785844800 },
    ],
  }, META);
  assert.deepEqual(list.map((s) => s.id), ['2606']);
});

test('sans métadonnées, le nom sert de filtre de repli', () => {
  const list = parseMeasuredStations({
    payload: [
      { loc: '2027', name: 'Genève, Lac Léman', parameter: 'temperature', value: 21.4, timestamp: 1785844800 },
      { loc: '2135', name: 'Basel, Rheinhalle', parameter: 'temperature', value: 24.1, timestamp: 1785844800 },
    ],
  }, null);
  assert.deepEqual(list.map((s) => s.id), ['2027']);
});

test('les coordonnées et l’horodatage sont exposés au reste de l’app', () => {
  const s = parseMeasuredStations(LATEST, META).find((x) => x.id === '2033');
  assert.deepEqual(s.coords, { lat: 46.5062, lon: 6.6266 });
  assert.equal(s.at.toISOString(), '2026-08-04T12:00:00.000Z');
});

console.log('\nsérie du modèle (Alplakes / Eawag)');

test('parseSeries lit variables.temperature.data', () => {
  const pts = parseSeries({
    time: ['2026-08-04T10:00:00+00:00', '2026-08-04T11:00:00+00:00', '2026-08-04T12:00:00+00:00'],
    variables: { temperature: { unit: 'degC', data: [21.1, 21.3, 21.5] } },
  });
  assert.equal(pts.length, 3);
  assert.equal(pts[2].value, 21.5);
  assert.equal(pts[0].at.toISOString(), '2026-08-04T10:00:00.000Z');
});

test('parseSeries accepte une variable donnée comme tableau nu', () => {
  const pts = parseSeries({ time: [1785841200, 1785844800], variables: { temperature: [20.5, 20.7] } });
  assert.deepEqual(pts.map((p) => p.value), [20.5, 20.7]);
});

test('les kelvins sont convertis en degrés Celsius', () => {
  const pts = parseSeries({
    time: ['2026-08-04T12:00:00Z'],
    variables: { temperature: { unit: 'K', data: [294.35] } },
  });
  assert.ok(Math.abs(pts[0].value - 21.2) < 0.05, `obtenu ${pts[0].value}`);
});

test('les trous du modèle (null, NaN) sont ignorés, la série reste triée', () => {
  const pts = parseSeries({
    time: ['2026-08-04T12:00:00Z', '2026-08-04T10:00:00Z', '2026-08-04T11:00:00Z'],
    variables: { temperature: { data: [21.5, null, 21.3] } },
  });
  assert.deepEqual(pts.map((p) => p.value), [21.3, 21.5]);
});

test('une réponse vide ou inattendue donne une série vide, sans lever', () => {
  assert.deepEqual(parseSeries({}), []);
  assert.deepEqual(parseSeries({ detail: 'Not Found' }), []);
  assert.deepEqual(parseSeries({ time: ['2026-08-04T12:00:00Z'], variables: {} }), []);
});

console.log('\nchoix de la valeur affichée');

const STATIONS = [
  { id: '2033', name: 'Ouchy', value: 21.8, at: hoursAgo(1), coords: { lat: 46.5062, lon: 6.6266 } },
  { id: '2027', name: 'Sécheron', value: 21.4, at: hoursAgo(1), coords: { lat: 46.2205, lon: 6.1478 } },
];

const SERIES = [
  { at: new Date(NOW - 3600 * 1000), value: 20.0 },
  { at: new Date(NOW + 600 * 1000), value: 20.2 },
  { at: new Date(NOW + 7200 * 1000), value: 20.6 },
];

test('une station proche et récente est préférée au modèle', () => {
  const r = bestReading(SPOTS.find((s) => s.key === 'lausanne'), STATIONS, SERIES, NOW);
  assert.equal(r.kind, 'measured');
  assert.equal(r.value, 21.8);
  assert.match(r.label, /Ouchy/);
});

test('un lieu éloigné de toute station retombe sur le modèle', () => {
  const r = bestReading(SPOTS.find((s) => s.key === 'montreux'), STATIONS, SERIES, NOW);
  assert.equal(r.kind, 'model');
  assert.equal(r.value, 20.2, 'le point le plus proche de maintenant doit être choisi');
});

test('une mesure proche mais périmée cède la place au modèle', () => {
  const vieilles = STATIONS.map((s) => ({ ...s, at: hoursAgo(30) }));
  const r = bestReading(SPOTS.find((s) => s.key === 'lausanne'), vieilles, SERIES, NOW);
  assert.equal(r.kind, 'model');
});

test('sans modèle, la mesure périmée est affichée plutôt que rien', () => {
  const vieilles = STATIONS.map((s) => ({ ...s, at: hoursAgo(30) }));
  const r = bestReading(SPOTS.find((s) => s.key === 'lausanne'), vieilles, [], NOW);
  assert.equal(r.kind, 'measured');
  assert.equal(r.value, 21.8);
});

test('sans aucune donnée, la lecture est explicitement indisponible', () => {
  const r = bestReading(SPOTS[0], [], [], NOW);
  assert.equal(r.value, null);
  assert.equal(r.kind, 'error');
  assert.equal(r.label, 'indisponible');
});

test('la distance de rattachement respecte la configuration', () => {
  const loin = [{ ...STATIONS[0], coords: { lat: 46.5062, lon: 6.6266 } }];
  const lausanne = SPOTS.find((s) => s.key === 'lausanne');
  assert.ok(distanceKm(lausanne, loin[0].coords) < CFG.nearStationKm);
  assert.ok(distanceKm(SPOTS.find((s) => s.key === 'vevey'), loin[0].coords) > CFG.nearStationKm);
});

console.log('\nindications de baignade');

test('les paliers de conseil couvrent toute la plage', () => {
  assert.match(advice(4), /Glacial/);
  assert.match(advice(13), /Froid/);
  assert.match(advice(19.5), /agréable/i);
  assert.match(advice(26), /chaude/);
  assert.equal(advice(null), '');
  assert.equal(advice(NaN), '');
});

console.log(`\n${passed} tests passés${process.exitCode ? ' — échecs ci-dessus' : ''}`);
