// Inscrit les températures du jour dans index.html, avant publication.
//
// Sans ce passage, un robot d'indexation ne voit que des tirets : toutes les
// valeurs de l'app arrivent par JavaScript, après une requête. Google exécute le
// JavaScript, mais tard, irrégulièrement, et sans garantie — alors que le contenu
// est déjà connu au moment de la publication. Autant l'écrire.
//
// Le script ne touche qu'à l'intérieur de marqueurs explicites. Il ne peut donc
// pas abîmer le reste de la page, et il est idempotent : le relancer sur une page
// déjà remplie donne le même résultat.
//
// Usage : node tools/prerender-seo.mjs [data/model.json] [index.html]

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { SPOTS, snapshotCurrentTemps } from '../sources.js';

const DATA = process.argv[2] || 'data/model.json';
const PAGE = process.argv[3] || 'index.html';
// Le sitemap suit la page : sans cela, viser une copie de test réécrirait le
// sitemap du dépôt, hors du dossier qu'on croyait modifier.
const SITEMAP = path.join(path.dirname(PAGE), 'sitemap.xml');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const fmt = (v) => (typeof v === 'number' && isFinite(v) ? `${v.toFixed(1).replace('.', ',')} °C` : '—');

// Remplace le contenu entre <!-- prerender:nom --> et <!-- /prerender:nom -->.
// Absence de marqueur = erreur : un silence ici laisserait la page sans valeurs
// sans que personne ne s'en aperçoive.
function fill(html, name, body) {
  const open = `<!-- prerender:${name} -->`;
  const close = `<!-- /prerender:${name} -->`;
  const a = html.indexOf(open);
  const b = html.indexOf(close);
  if (a < 0 || b < a) throw new Error(`marqueur « ${name} » introuvable dans ${PAGE}`);
  return html.slice(0, a + open.length) + body + html.slice(b);
}

const raw = JSON.parse(await readFile(DATA, 'utf8'));
const temps = snapshotCurrentTemps(raw);
const found = SPOTS.filter((s) => isFinite(temps[s.key])).length;
if (!found) throw new Error(`aucune température exploitable dans ${DATA}`);

const rows = SPOTS
  .map((s) => `\n      <li><span>${esc(s.name)}</span><b>${fmt(temps[s.key])}</b></li>`)
  .join('') + '\n      ';

// Horodatage lisible, en heure suisse : c'est le public du site.
const at = new Date(raw.generatedAt || Date.now());
const quand = at.toLocaleString('fr-CH', {
  timeZone: 'Europe/Zurich', day: 'numeric', month: 'long',
  hour: '2-digit', minute: '2-digit',
});
const stamp = `Valeurs du ${quand}, heure suisse. Rafraîchies toutes les heures.`;

let html = await readFile(PAGE, 'utf8');
html = fill(html, 'temps', rows);
html = fill(html, 'stamp', esc(stamp));
await writeFile(PAGE, html);

// `lastmod` du sitemap : il dit aux robots que la page a bougé, ce qui est vrai
// à chaque passage puisque les valeurs changent.
try {
  const map = await readFile(SITEMAP, 'utf8');
  const day = at.toISOString().slice(0, 10);
  const next = /<lastmod>/.test(map)
    ? map.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${day}</lastmod>`)
    : map.replace('<changefreq>', `<lastmod>${day}</lastmod>\n    <changefreq>`);
  await writeFile(SITEMAP, next);
  console.log(`${SITEMAP} : lastmod ${day}`);
} catch (err) {
  console.warn(`sitemap non mis à jour (${err.message})`);
}

console.log(`${PAGE} : ${found}/${SPOTS.length} températures inscrites, ${quand}`);
