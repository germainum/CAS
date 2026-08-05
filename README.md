# Bains Froids Léman

Application web installable (PWA) pour préparer un bain froid dans le Léman : la
température de l'eau à l'endroit où vous êtes, la durée conseillée qui en découle,
et un minuteur qui guide l'immersion. Conçue pour l'iPhone — elle s'ajoute à
l'écran d'accueil, s'ouvre en plein écran comme une app native, et fonctionne hors
ligne avec la dernière valeur connue.

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

L'écran d'accueil est un écran de préparation, tenu à quatre éléments : rien à
lire, une décision à prendre.

- la **température de l'eau** au lieu courant, en très gros — c'est la seule
  information dont dépend tout le reste ; elle est estompée au-delà de six heures ;
- trois **repères** sous le chiffre : la **tendance sur 24 h** (`+0,4°`, `stable`),
  l'**âge du relevé**, et la **source** — nom de la station officielle, ou `Eawag`
  pour la simulation. Aucun de ces trois ne répète le chiffre : ils disent d'où il
  vient et s'il bouge ;
- **mon temps de présence**, réglable, qui découle de la température ;
- le **bouton de lancement** — « Je me jette à l'eau ». Il vit dans un bandeau
  fixe, toujours visible, y compris en parcourant la carte ou la courbe plus bas :
  le geste ne doit dépendre ni de remonter pour le retrouver, ni d'un excès de
  prudence pour l'éviter par mégarde.

Le **lieu le plus proche de vous** est sélectionné d'emblée si la localisation est
autorisée, avec la distance affichée.

En dessous : une **carte du lac** portant la température des dix lieux,
comparables entre elles car toutes issues du modèle, et une **courbe sur sept
jours** — cinq écoulés en trait plein, deux de prévision en pointillé.

Dix lieux sont proposés, des Pâquis au Bouveret. On passe de l'un à l'autre par un
**point de la carte**, par **balayage horizontal** sur le premier écran, ou par les
flèches du clavier. Le balayage cède la place au défilement dès que le geste est
vertical. Aux extrémités, il s'arrête plutôt que de boucler.

Pour ajouter un lieu, complétez la constante `SPOTS` dans `sources.js` : le point
doit se situer **sur l'eau**, sinon la simulation ne renvoie rien.

## Minuteur de bain froid

La durée conseillée découle de la température de l'eau : **une minute par degré**,
et c'est un plafond, jamais un objectif. Dix minutes à 10 °C. La valeur est
plafonnée à 20 minutes, car au-delà de 18 °C la règle perd son sens — ce n'est
plus un bain froid. Elle reste réglable à la main.

Pendant l'immersion, une **respiration guidée** accompagne l'entrée dans l'eau :
quatre secondes d'inspiration, six d'expiration, l'expiration allongée étant ce
qui calme la réponse au choc thermique. Un cercle s'ouvre et se referme au rythme
de la consigne, pour ne pas avoir à lire.

Un **message du coach** l'accompagne, ancré dans le temps plutôt que dans la
mécanique de sécurité : « Installe-toi » à 0:00, « le premier souffle coupé,
c'est normal » à 0:15, « ton corps s'ajuste » à une minute, « rien à prouver »
à mi-parcours, « encore un souffle » dans la dernière minute, « voilà » à
l'échéance — et pendant le dépassement. `bathCoach()` dans `sources.js` retient
le seuil le plus avancé déjà atteint ; sur un bain très court, où plusieurs
seuils tombent à la même seconde, les seuils relatifs à la durée choisie
(mi-parcours, dernière minute, fin) l'emportent sur ceux à heure fixe.

Le lancement demande **deux gestes** : « Démarrer », qui affiche les consignes
essentielles, puis un **maintien d'une seconde** sur un bouton circulaire dont
l'anneau se remplit. Ce n'est pas une coquetterie : cette seconde impose une
lecture des consignes juste avant d'entrer dans l'eau, et rend impossible un
lancement par mégarde. Relâcher trop tôt n'enclenche rien et le dit.

C'est là, et nulle part ailleurs, que se lisent les six consignes de sécurité —
« quelqu'un vous accompagne et vous voit » en tête. L'écran d'accueil ne les
répète pas : elles n'ont d'utilité qu'au moment d'entrer dans l'eau.

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
| [Natural Earth](https://www.naturalearthdata.com/) | contour du lac | domaine public | figé dans `sources.js` |

Une mesure officielle située à moins de 12 km du lieu choisi et datant de moins de
six heures est privilégiée ; sinon la simulation prend le relais ; sinon le cache
local, avec son âge affiché.

### La carte

Le contour du Léman vient de **Natural Earth 10m** (domaine public), converti
depuis son GeoJSON en `[lat, lon]` dans `sources.js`. Trente-huit points : la
silhouette est juste, mais lissée près des rives — ce n'est pas une carte de
navigation.

Toucher la carte sélectionne le lieu **le plus proche du doigt**, sur une seule
zone sensible couvrant le dessin. Une cible par lieu semblait plus naturelle, mais
au Haut-Lac, Montreux et Le Bouveret ne sont qu'à quatre kilomètres : des cibles
confortables s'y recouvraient et l'une des deux devenait inatteignable. Au clavier,
les flèches font le même travail.

Un test vérifie que **les dix lieux tombent dans l'eau**, et il travaille : il a
d'abord pris Genève et Nyon en défaut sur un contour dessiné à la main, puis
Genève, Le Bouveret, Évian et Thonon sur le contour réel, plus sévère près des
rives. Les quatre ont été repoussés de 0,2 à 1,5 km au large. Sa portée dépasse
la carte : un point posé à terre n'obtiendrait aucune valeur du modèle.

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
| `tools/test-parsers.mjs` | 86 tests sur `sources.js` |
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
