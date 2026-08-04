# Température du Léman

Application web installable (PWA) qui affiche la température de l'eau du lac Léman,
lieu par lieu. Conçue pour l'iPhone : elle s'ajoute à l'écran d'accueil, s'ouvre en
plein écran comme une app native, et fonctionne hors ligne avec la dernière valeur
connue.

Aucun compte, aucune clé d'API, aucune étape de compilation : dix fichiers statiques.

## Installation sur iPhone

1. Publiez le site (voir « Déploiement » ci-dessous) — Safari exige HTTPS pour
   installer une PWA.
2. Ouvrez l'adresse dans **Safari** (pas Chrome : sur iOS, seul Safari peut installer).
3. **Partager** → **Sur l'écran d'accueil** → **Ajouter**.

L'icône apparaît sur l'écran d'accueil ; au lancement, l'app s'ouvre sans barre
d'adresse et affiche immédiatement la dernière température en cache, avant de
rafraîchir.

## Ce qu'affiche l'app

- La **température actuelle** au lieu choisi, en grand, avec l'âge de la donnée.
- Un badge indiquant la nature de la valeur : `mesure` (station officielle proche)
  ou `modèle Eawag` (simulation du lac). Une valeur de plus de six heures est
  estompée.
- Une **courbe sur sept jours** : cinq jours écoulés en trait plein, deux jours de
  prévision en pointillé.
- La liste des **stations de mesure** du bassin lémanique avec leur relevé.
- Une indication de baignade, sans valeur officielle.

Dix lieux sont proposés, des Pâquis au Bouveret. Pour en ajouter, complétez la
constante `SPOTS` dans `sources.js` : le point doit se situer **sur l'eau**, sinon
la simulation ne renvoie rien.

## Sources de données

| Source | Rôle | Nature |
| --- | --- | --- |
| [existenz.ch](https://api.existenz.ch/) (données OFEV) | températures mesurées en station | mesure in situ |
| [Alplakes / Eawag](https://www.alplakes.eawag.ch/) | valeur en tout point + historique + prévision | simulation Delft3D-FLOW |

Les deux sources sont interrogées en parallèle et indépendamment : si l'une tombe,
l'app reste utile. Une mesure officielle située à moins de 12 km du lieu choisi et
datant de moins de six heures est privilégiée ; sinon la simulation prend le relais ;
sinon le cache local, avec son âge affiché.

> **À vérifier une fois en ligne.** L'environnement dans lequel ce code a été écrit
> n'avait pas accès à ces deux API : la forme exacte de leurs réponses n'a donc pas
> pu être confrontée au réel. Les analyseurs sont volontairement tolérants (noms de
> champs alternatifs, kelvins, valeurs manquantes) et couverts par des tests, mais
> lancez `npm run check` depuis une machine connectée pour confirmer — le script
> imprime le code HTTP, l'en-tête CORS et ce que l'app afficherait. En cas d'écart,
> tout se corrige dans `sources.js`, sans toucher à l'interface.

## Développement

```bash
npm test                      # tests de la couche données, sans réseau
npm run check                 # interroge les API réelles et diagnostique
npm run check montreux        # idem pour un autre lieu
npm run serve                 # sert le site sur http://localhost:4173
npm run icons                 # régénère les icônes (nécessite pillow)
```

L'app expose aussi un dépliant **« Diagnostic des sources »** en bas de page :
utile depuis l'iPhone lui-même, il liste les appels réussis ou échoués.

### Fichiers

| Fichier | Rôle |
| --- | --- |
| `index.html` | structure de la page et métadonnées iOS |
| `app.css` | mise en forme, thèmes clair et sombre, encoches d'écran |
| `sources.js` | URL, analyse des réponses, choix de la valeur — sans DOM ni réseau |
| `app.js` | requêtes, cache local, rendu, cycle de vie |
| `sw.js` | service worker : coque en cache, lancement hors ligne |
| `manifest.webmanifest` | nom, icônes, mode plein écran |
| `tools/test-parsers.mjs` | 25 tests sur `sources.js` |
| `tools/check-sources.mjs` | vérification des API en conditions réelles |
| `tools/make-icons.py` | génération des icônes PNG |

`sources.js` ne touche ni au DOM ni au réseau, ce qui permet de le tester
directement sous Node : c'est là que vit toute la logique susceptible de casser
quand une API amont change.

## Déploiement

**Avec GitHub Actions** (workflow `.github/workflows/pages.yml` inclus) :
dans *Settings → Pages*, choisissez **Source : GitHub Actions**. Chaque poussée sur
la branche par défaut lance les tests puis publie le site.

**Sans Actions** : dans *Settings → Pages*, choisissez **Deploy from a branch**, la
branche voulue et le dossier `/ (root)`. Le fichier `.nojekyll` garantit que tous
les fichiers sont servis tels quels.

Tout hébergeur statique en HTTPS convient également.

## Limites

- La simulation Alplakes n'est pas une mesure : elle peut s'écarter de la réalité
  locale, en particulier près des rives et lors de remontées d'eau froide (bise).
- Les stations de l'OFEV mesurent la température près de la surface à un point
  précis ; une plage abritée peut être sensiblement plus chaude.
- Aucune donnée de qualité de l'eau ni de sécurité de baignade n'est fournie.

## Licence

MIT.
