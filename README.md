# rtgre.fr

Emploi du temps, évaluations et suivi de notes pour les BUT3 Réseaux et Télécoms de l'IUT1 de Grenoble.

Site en ligne : [rtgre.fr](https://rtgre.fr)

Ce n'est pas un site officiel de l'IUT. Je l'ai écrit pour ma promotion, parce que retrouver ses partiels dans l'ADE demande de naviguer semaine par semaine, et que savoir à quelle heure une autre classe finit sa journée est impossible sans ouvrir un second calendrier.

---

## Ce que fait le site

Il récupère les calendriers ADE des six classes de BUT3 RT, en extrait ce qui est utile, et publie des pages statiques.

Pour chaque classe :

- la liste des évaluations de l'année, avec la salle, les enseignants et les groupes concernés
- pour chaque évaluation, sa date et ses conditions dans les cinq autres classes
- l'emploi du temps complet, en vue jour, semaine ou année, avec un repère de l'heure courante
- la comparaison de son emploi du temps avec celui d'une autre classe, pour savoir quand un camarade commence et finit sa journée
- un tableau de saisie de notes qui calcule les moyennes par UE, par semestre et sur l'année
- les liens vers les espaces Chamilo des modules de sa classe

---

## Comment ça marche

Un site statique ne peut pas interroger l'ADE depuis le navigateur : la ressource est une JSP et les requêtes seraient bloquées par la politique d'origine. La récupération se fait donc à la construction, pas à l'exécution.

```
ADE (6 calendriers iCalendar)
  -> GitHub Actions, toutes les 6 heures
    -> script Python : téléchargement, analyse, classement, appariement
      -> pages HTML et fichiers JSON dans dist/
        -> GitHub Pages
```

Le HTML est donc pré-généré. Le JavaScript n'ajoute que le filtrage, la navigation dans le calendrier et le calcul des moyennes. Sans lui, les évaluations restent lisibles et toutes les pages navigables.

Aucun serveur applicatif, aucune base de données, aucun compte utilisateur.

---

## Installation

Python 3.12.

```bash
git clone git@github.com:kzsxwsjuldvcbsqt/rtgre.git
cd rtgre
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Trois dépendances, toutes épinglées : `requests`, `icalendar`, `Jinja2`.

## Construction

```bash
PYTHONPATH=src python -m schedule.build
```

Le site est écrit dans `dist/`. Pour le consulter :

```bash
python -m http.server 8000 --directory dist
```

En local, la racine servie est `/`. En production, elle dépend de `base_path`. Un lien absolu qui se glisserait dans un gabarit fonctionnerait donc en local et casserait en ligne. C'est le seul écart entre les deux environnements.

La construction interroge l'ADE : elle a besoin d'un accès réseau et prend quelques dizaines de secondes.

---

## Configuration

Tout ce qui peut changer sans toucher au code vit dans `config/`. Le code source ne contient aucun commentaire : cette section est donc la documentation du projet.

| Fichier | Contenu |
| --- | --- |
| `site.json` | Titre, fuseau horaire, URL de l'ADE, chemin de déploiement, domaine, affichage des enseignants, formats de date, seuils |
| `classes.json` | Les six classes, leur identifiant de ressource ADE, leur parcours et leur statut |
| `curriculum.json` | Semestres, unités d'enseignement, modules, coefficients, liens Chamilo |
| `categories.json` | Règles de reconnaissance des évaluations dans les intitulés ADE |
| `sections.json` | Les sections du site et leur ordre dans la navigation |
| `labels.json` | Toutes les chaînes visibles par l'utilisateur |
| `calendar.json` | Vue par défaut et options de l'emploi du temps |

Aucune chaîne française n'apparaît dans un fichier `.py`, `.js` ou `.css`.

### Réglages les plus utiles

**Affichage des enseignants**, dans `site.json` :

```json
"teachers": { "display_mode": "given_name_initial" }
```

Quatre valeurs : `full` donne `DUPONT JEAN`, `initials` donne `J. D.`, `given_name_initial` donne `Jean D.`, `hidden` supprime la colonne partout, y compris dans les fichiers JSON publiés. Le mode actif est `given_name_initial`.

**Catégories d'évaluation**, dans `categories.json`. Chaque catégorie porte des expressions régulières appliquées à l'intitulé ADE. Ajouter une catégorie ou modifier un motif ne demande aucune modification de code. L'ordre du tableau est l'ordre de priorité : le premier motif qui correspond gagne.

**Coefficients**, dans `curriculum.json`, indexés par parcours, statut, module et unité d'enseignement. C'est la donnée la plus sensible du projet : une erreur ici ne se voit qu'en fin de semestre. Trois contrôles la protègent, décrits plus bas.

**Déploiement**, dans `site.json` :

```json
"base_path": "/",
"custom_domain": "rtgre.fr"
```

Sur un domaine dédié, `base_path` vaut `/`. Sur une page de projet GitHub, il vaut le nom du dépôt entre barres obliques. Les deux vont ensemble : les changer séparément produit un site aux liens brisés.

Le fichier `CNAME` exigé par GitHub Pages est généré par la construction, pas versionné. Sans quoi il disparaîtrait à chaque déploiement.

---

## Structure du dépôt

```
config/      configuration, la totalité des valeurs modifiables
src/schedule/
  fetcher.py     téléchargement des calendriers ADE
  parser.py      analyse iCalendar, normalisation des salles et des noms
  classifier.py  reconnaissance des catégories d'évaluation
  matcher.py     appariement des évaluations entre classes
  curriculum.py  maquette pédagogique, coefficients, liens Chamilo
  renderer.py    génération des pages
  exporter.py    fichiers JSON de données par classe
  build.py       point d'entrée
templates/   gabarits Jinja2
static/      feuille de style, scripts, favicon
```

Un module par responsabilité. `build.py` enchaîne les étapes et ne contient pas de logique métier.

---

## Garde-fous

La construction échoue plutôt que de publier un site faux. Le déploiement précédent reste alors en ligne, ce qui est préférable à des données incomplètes.

- téléchargement ADE en échec après trois tentatives
- coefficient déclaré pour un module qui n'existe pas
- module noté sans aucun coefficient
- unité d'enseignement ne recevant aucun coefficient
- accès à une variable inexistante dans un gabarit

Les trois contrôles sur les coefficients viennent d'une panne réelle : des codes de modules avaient été altérés, plusieurs UE se retrouvaient vides, et la page de notes s'est déployée sans que rien ne le signale. Le dernier contrôle vient de la même cause côté gabarit, Jinja rendant silencieusement une chaîne vide pour une clé absente.

---

## Données personnelles

Le site ne collecte rien.

Les notes saisies restent dans le `localStorage` du navigateur. Elles ne sont envoyées nulle part, il n'y a ni serveur ni compte. L'export produit un fichier JSON téléchargé localement, l'import le relit localement. Vider les données du navigateur les efface définitivement.

Les enseignants sont désignés par leur prénom et l'initiale de leur nom. Les intitulés de cours, les salles et les coefficients sont des informations publiques diffusées par l'IUT.

Le site n'est pas indexé : chaque page porte une balise `noindex`, et `robots.txt` autorise l'exploration pour que cette balise puisse être lue. Interdire l'exploration serait contre-productif, un moteur ne pouvant alors pas voir l'instruction qui lui interdit d'indexer.

Aucune requête vers un tiers. Pas de police distante, pas de CDN, pas de mesure d'audience.

---

## Vérification du repère d'heure

L'emploi du temps affiche un repère de l'heure courante dans la journée du jour. Hors période de cours, il est impossible à observer.

Un paramètre du fragment d'URL permet de simuler un instant :

```
/classes/b3dc3/calendar.html#view=week&date=2026-09-08&now=2026-09-08T10:30
```

Le repère se place alors à l'heure demandée et la minuterie de rafraîchissement ne démarre pas. Ce paramètre est lu uniquement par la page de l'emploi du temps, ne modifie aucune donnée et n'est jamais écrit par le site.

---

## Conventions de code

- aucun commentaire, aucune docstring
- code, variables et identifiants en anglais
- interface en français, chaînes centralisées dans `labels.json`
- aucune dépendance côté client, ni framework ni bibliothèque
- aucune valeur métier écrite dans le code

L'absence de commentaires est un choix assumé : le code doit être lisible par ses seuls noms d'identifiants, et tout ce qui demande une explication appartient à la configuration ou à ce fichier.

---

## Limites connues

**La feuille de style a dérivé.** Elle devait rester sous 160 lignes ; elle en fait 1700, avec une architecture en `@layer` et un mode sombre qui n'étaient pas prévus. C'est le principal chantier de reprise.

**L'analyse dépend du format des intitulés ADE.** Un changement de nomenclature côté scolarité, par exemple `DS` devenant `Devoir`, viderait la page des évaluations sans erreur visible. Les motifs sont en configuration pour que la correction reste rapide.

**L'extraction des enseignants est heuristique.** Les noms sont reconnus par leur forme dans un champ de description libre. Les cas particuliers rencontrés sont traités, mais un format inédit peut produire une valeur aberrante.

**La maquette pédagogique est saisie à la main.** Coefficients, unités d'enseignement et identifiants Chamilo ont été relevés depuis des documents. Ils doivent être vérifiés à chaque changement de programme.

**Le format du sélecteur de date suit le navigateur.** Un `<input type="date">` s'affiche selon la langue configurée dans le navigateur, pas selon celle du document. Le titre de période, lui, affiche toujours la date au format français.

**Sans JavaScript**, la page des notes ne calcule rien et l'emploi du temps se limite à la semaine pré-générée. Les évaluations, les modules et les pages de détail restent complètes.

---

## Licence

MIT. Voir `LICENSE`.