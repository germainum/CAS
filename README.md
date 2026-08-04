# Température du Léman

Application web installable (PWA) qui affiche la température de l'eau du lac Léman,
lieu par lieu. Conçue pour l'iPhone : elle s'ajoute à l'écran d'accueil, s'ouvre en
plein écran comme une app native, et fonctionne hors ligne avec la dernière valeur
connue.

Aucun compte, aucune clé d'API, aucun paquet à installer : des fichiers statiques et
un instantané de données produit par la CI.

## Installation sur iPhone

1. Publiez le site (voir « Déploiement » ci-dessous) — Safari exige HTTPS pour
   installer une PWA.
2. Ouvrez l'adresse dans **Safari** (pas Chrome : sur iOS, seul Safari peut installer).
3. **Partager** → **Sur l'écran d'accueil** → **Ajouter**.

L'icône apparaît sur l'écran d'accueil ; au lancement, l'app s'ouvre sans barre
d'adresse et affiche immédiatement la dernière température en cache, avant de
rafraîchir.

## Ce qu'affiche l'app

- La **température actuelle** au lieu choisi, en très gros caractères en haut
  d'écran, avec l'âge de la donnée.
- Une **carte du lac** portant la température des dix lieux, comparables entre
  elles car toutes issues du modèle. Un point se touche pour changer de lieu.
- La nature de la valeur sous le chiffre : `mesure` (station officielle proche)
  ou `modèle Eawag` (simulation du lac). Une valeur de plus de six heures est
  estompée.
- Une **courbe sur sept jours** : cinq jours écoulés en trait plein, deux jours de
  prévision en pointillé.
- La liste des **stations de mesure** du bassin lémanique avec leur relevé.
- Une indication de baignade, sans valeur officielle.
- Un **minuteur de bain froid** et les règles de sécurité qui vont avec.

Dix lieux sont proposés, des Pâquis au Bouveret. On passe de l'un à l'autre par
le ruban en bas d'écran, par **balayage horizontal** sur le premier écran, ou par
les flèches du clavier. Le balayage cède la place au défilement dès que le geste
est vertical, et ne se déclenche pas depuis le ruban, qui défile pour son propre
compte. Aux extrémités, il s'arrête plutôt que de boucler.

Pour ajouter un lieu, complétez la constante `SPOTS` dans `sources.js` : le point
doit se situer **sur l'eau**, sinon la simulation ne renvoie rien.

## Minuteur de bain froid

La durée conseillée découle de la température de l'eau : **une minute par degré**,
et c'est un plafond, jamais un objectif. Dix minutes à 10 °C. La valeur est
plafonnée à 20 minutes, car au-delà de 18 °C la règle perd son sens — ce n'est
plus un bain froid. Elle reste réglable à la main.

Le lancement demande **deux gestes** : « Démarrer », qui affiche les consignes
essentielles, puis un **maintien d'une seconde** sur un bouton circulaire dont
l'anneau se remplit. Ce n'est pas une coquetterie : cette seconde impose une
lecture des consignes juste avant d'entrer dans l'eau, et rend impossible un
lancement par mégarde. Relâcher trop tôt n'enclenche rien et le dit.

Pendant l'immersion, le minuteur passe par trois temps, dont les seuils suivent la
durée totale : entrée dans l'eau (respiration), régime stable (rester près du
bord), puis préparation de la sortie. À l'échéance, il compte le dépassement
plutôt que de s'arrêter en silence.

Deux détails d'implémentation qui comptent :

- le décompte se calcule depuis un **horodatage de départ**, jamais par
  accumulation de ticks : iOS suspend le JavaScript en arrière-plan, et un
  compteur incrémental dériverait ;
- la session est **conservée** : un rechargement en pleine immersion la retrouve,
  et une sortie l'efface définitivement.

Le signal sonore ne peut pas retentir si l'app est en arrière-plan — iOS y suspend
l'audio. L'écran le rappelle plutôt que de le taire.

Les règles affichées viennent de la SSS, 24 heures, 20 minutes et la WTA, citées
dans l'app. Elles ne remplacent pas un avis médical.

## Sources de données

| Source | Rôle | Nature | Chemin |
| --- | --- | --- | --- |
| [existenz.ch](https://api.existenz.ch/) (données OFEV) | températures mesurées en station | mesure in situ | appelée directement par le navigateur |
| [Alplakes / Eawag](https://www.alplakes.eawag.ch/) | valeur en tout point + historique + prévision | simulation Delft3D-FLOW | précalculée par la CI (voir ci-dessous) |

Une mesure officielle située à moins de 12 km du lieu choisi et datant de moins de
six heures est privilégiée ; sinon la simulation prend le relais ; sinon le cache
local, avec son âge affiché.

### La carte

Le contour du Léman est tracé à la main dans `sources.js`, en une cinquantaine de
points de rive : l'environnement de développement n'a pas d'accès réseau pour
récupérer un contour officiel. Il vise la silhouette reconnaissable du lac, pas
la précision cartographique.

Un test vérifie que **les dix lieux tombent dans l'eau** — il a d'ailleurs pris
Genève et Nyon en défaut, tous deux trop près de la rive. Sa portée dépasse la
carte : un point posé à terre n'obtiendrait aucune valeur du modèle.

### Pourquoi le modèle passe par la CI

L'API Alplakes ne renvoie pas d'en-tête CORS : le navigateur refuse donc l'appel
depuis une page web, alors que la même URL fonctionne parfaitement hors navigateur.
`tools/build-model-data.mjs` l'interroge donc dans GitHub Actions — où CORS n'existe
pas — pour les dix lieux, et dépose `data/model.json` dans le site publié. L'app lit
ce fichier depuis sa propre origine, sans requête bloquée.

Le workflow tourne à chaque poussée **et toutes les heures**, ce qui suffit largement :
la température d'un lac varie de moins d'un demi-degré par heure. Trois garde-fous :

- l'instantané déjà en ligne est récupéré avant régénération, donc une panne
  d'Alplakes ne fait pas disparaître les données publiées ;
- un échec de génération ne bloque pas la publication du code ;
- l'app affiche l'âge de l'instantané dès qu'il dépasse six heures — une CI en panne
  se voit, au lieu de figer silencieusement la température.

`data/model.json` n'est pas versionné : c'est un produit de compilation. Pour le
générer en local, `npm run data`.

## Développement

```bash
npm test                      # tests de la couche données, sans réseau
npm run data                  # génère data/model.json (nécessite le réseau)
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
| `bath.js` | minuteur : consignes, maintien de confirmation, phases, session |
| `lakemap.js` | carte du lac : silhouette, points, températures |
| `sw.js` | service worker : réseau d'abord, cache en secours |
| `manifest.webmanifest` | nom, icônes, mode plein écran |
| `tools/build-model-data.mjs` | précalcul de `data/model.json` dans la CI |
| `tools/test-parsers.mjs` | 62 tests sur `sources.js` |
| `tools/check-sources.mjs` | vérification des API en conditions réelles |
| `tools/make-icons.py` | génération des icônes PNG |

`sources.js` ne touche ni au DOM ni au réseau, ce qui permet de le tester
directement sous Node : c'est là que vit toute la logique susceptible de casser
quand une API amont change.

## Déploiement

**Avec GitHub Actions** (workflow `.github/workflows/pages.yml` inclus) : rien à
régler. Le workflow active lui-même GitHub Pages en mode « GitHub Actions »
(`enablement: true`) au premier passage. Chaque poussée sur la branche par défaut
lance les tests puis publie le site ; une pull request se limite aux tests.

**Sans Actions** : dans *Settings → Pages*, choisissez **Deploy from a branch**, la
branche voulue et le dossier `/ (root)`. Le fichier `.nojekyll` garantit que tous
les fichiers sont servis tels quels. Attention : `data/model.json` n'étant pas
versionné, cette voie prive l'app du modèle — il faut alors lancer `npm run data` et
committer le fichier, ou renoncer à la courbe.

Tout hébergeur statique en HTTPS convient également, à condition d'y exécuter
`npm run data` à intervalle régulier.

## Limites

- La simulation Alplakes n'est pas une mesure : elle peut s'écarter de la réalité
  locale, en particulier près des rives et lors de remontées d'eau froide (bise).
- Sa fraîcheur est celle du dernier passage de la CI, une heure au plus.
  GitHub désactive les workflows planifiés après 60 jours sans activité sur le
  dépôt : au-delà, l'instantané cesse de se rafraîchir et l'app l'indique.
- Les stations de l'OFEV mesurent la température près de la surface à un point
  précis ; une plage abritée peut être sensiblement plus chaude.
- Aucune donnée de qualité de l'eau ni de sécurité de baignade n'est fournie.

## Licence

MIT.
