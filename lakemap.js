// Carte du lac : silhouette du Léman, un point par lieu, sa température, et la
// sélection au toucher. Les valeurs viennent toutes de l'instantané du modèle —
// une seule source pour que les lieux soient comparables entre eux.

import { LAKE_OUTLINE, SPOTS, mood, projectPoints } from './sources.js';

const W = 340;
const H = 208;

// Teintes des points, une par bande de température. Choisies lumineuses pour
// tenir sur le fond clair comme sur le fond sombre.
const BAND_COLOR = {
  cold: '#7aa8f0',
  cool: '#4fb9e8',
  fresh: '#3fc3a3',
  good: '#a9cd4a',
  warm: '#f2913c',
  unknown: 'currentColor',
};

// Côté où poser l'étiquette : au nord pour la rive suisse, au sud pour la rive
// française. Les lieux serrés du Haut-Lac sont écartés à la main.
const LABEL_SIDE = {
  // Morges est renvoyée au sud-ouest : au nord, son étiquette touchait celle de
  // Lausanne, à quarante-sept unités seulement sur ce cadrage.
  geneve: 'sw', nyon: 'sw', morges: 'sw', lausanne: 'n', vevey: 'n',
  montreux: 'e', bouveret: 's', evian: 's', thonon: 's', yvoire: 's',
};

const OFFSETS = {
  n: [0, -13, 'middle'],
  s: [0, 20, 'middle'],
  e: [11, 4, 'start'],
  sw: [-11, 17, 'end'],
  se: [11, 17, 'start'],
};

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const fmt = (v) => (typeof v === 'number' && isFinite(v) ? v.toFixed(1).replace('.', ',') : '--');

// Rend la carte dans `box`. `temps` associe une clé de lieu à sa température.
export function renderLakeMap(box, { temps = {}, selectedKey, onSelect, user = null } = {}) {
  const { points, project } = projectPoints(LAKE_OUTLINE, { width: W, height: H, pad: 36 });
  const shore = `${points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('')}Z`;

  const marks = SPOTS.map((spot) => {
    const [x, y] = project(spot.lat, spot.lon);
    const t = temps[spot.key];
    const band = mood(t).band;
    const [dx, dy, anchor] = OFFSETS[LABEL_SIDE[spot.key] ?? 'n'];
    const on = spot.key === selectedKey;

    return `<g class="spot${on ? ' on' : ''}" data-key="${esc(spot.key)}">`
      + (on ? `<circle class="ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8.5"/>` : '')
      + `<circle class="dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${on ? 5.5 : 4}"`
      + ` fill="${BAND_COLOR[band] ?? BAND_COLOR.unknown}"/>`
      + `<text class="lab" x="${(x + dx).toFixed(1)}" y="${(y + dy).toFixed(1)}"`
      + ` text-anchor="${anchor}">${fmt(t)}°</text>`
      + `<text class="nom" x="${(x + dx).toFixed(1)}" y="${(y + dy + (dy < 0 ? -11 : 11)).toFixed(1)}"`
      + ` text-anchor="${anchor}">${esc(spot.name)}</text>`
      + '</g>';
  }).join('');

  // Une seule zone sensible, plutôt qu'une cible par lieu : au Haut-Lac,
  // Montreux et Le Bouveret ne sont qu'à quatre kilomètres, et des cibles
  // confortables s'y recouvriraient — l'une des deux devenant inatteignable.
  // Le lieu retenu est donc le plus proche du doigt.
  const positions = SPOTS.map((spot) => {
    const [x, y] = project(spot.lat, spot.lon);
    return { key: spot.key, x, y };
  });

  // Position de l'utilisateur, si elle est connue et dans le cadre.
  let me = '';
  if (user && isFinite(user.lat) && isFinite(user.lon)) {
    const [ux, uy] = project(user.lat, user.lon);
    if (ux > -12 && ux < W + 12 && uy > -12 && uy < H + 12) {
      me = `<g class="me"><circle class="me-halo" cx="${ux.toFixed(1)}" cy="${uy.toFixed(1)}" r="9"/>`
        + `<circle class="me-dot" cx="${ux.toFixed(1)}" cy="${uy.toFixed(1)}" r="3.2"/>`
        + '<title>Votre position</title></g>';
    }
  }

  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img"`
    + ' aria-label="Carte du Léman et température de l’eau par lieu">'
    + `<path class="shore" d="${shore}"/>${me}${marks}`
    + `<rect class="hitarea" x="0" y="0" width="${W}" height="${H}" aria-hidden="true"/></svg>`;

  if (!onSelect) return;

  const svg = box.querySelector('svg');

  // Le viewBox conserve son rapport : une mise à l'échelle linéaire suffit à
  // repasser des pixels de l'écran aux unités du dessin.
  svg.addEventListener('click', (e) => {
    const r = svg.getBoundingClientRect();
    if (!r.width) return;
    const x = ((e.clientX - r.left) / r.width) * W;
    const y = ((e.clientY - r.top) / r.height) * H;

    const near = positions
      .map((p) => ({ ...p, d: Math.hypot(p.x - x, p.y - y) }))
      .reduce((a, b) => (b.d < a.d ? b : a));
    // Au-delà, le geste ne visait aucun lieu en particulier.
    if (near.d <= 34) onSelect(near.key);
  });
}
