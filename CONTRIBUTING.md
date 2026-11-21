# Contribuer à rtgre

Ce guide décrit la façon de travailler sur le dépôt. Les mêmes règles s'appliquent à [rtgre-platform](https://github.com/kzsxwsjuldvcbsqt/rtgre-platform), qui déploie le site.

## Préparer le poste

Les versions de Python, Node et des outils sont fixées dans `mise.toml`. La CI utilise les mêmes.

```bash
mise install
mise run deps
pre-commit install
```

`mise run deps` installe les dépendances Python dans `.venv` et les dépendances JavaScript dans `node_modules`. `pre-commit install` active les contrôles avant chaque commit et la vérification du message.

## Façon de travailler

1. Chaque travail part d'une issue, ouverte avec l'un des modèles : erreur, idée ou tâche.
2. Une branche par issue, créée depuis `main` et nommée `type/sujet`, par exemple `fix/horaires-pause` ou `feat/vue-mois`.
3. Une pull request qui remplit le modèle et ferme l'issue avec `Closes #n`.
4. La fusion se fait par commit de merge, une fois la CI verte. La branche est supprimée ensuite.

`main` est protégée : pas de poussée directe, pas de réécriture, commits signés et contrôles verts obligatoires.

## Messages de commit

Les messages suivent [Conventional Commits](https://www.conventionalcommits.org/fr/), en français :

```text
type(portée): description au présent, sans majuscule ni point final

Corps facultatif : le pourquoi du changement, pas le comment.

Closes #12
```

| Type | Usage |
| --- | --- |
| `feat` | fonction nouvelle ou changement visible du site |
| `fix` | correction d'une erreur |
| `perf` | affichage ou génération plus rapide |
| `refactor` | réorganisation du code sans changement visible |
| `test` | tests seuls |
| `docs` | documentation seule |
| `build` | outils, dépendances de construction, `mise.toml` |
| `ci` | workflows GitHub Actions |
| `chore` | maintenance, mises à jour de dépendances |
| `revert` | annulation d'un commit |

La portée désigne la partie du site touchée : `emploi-du-temps`, `evaluations`, `notes`, `modules`, `navigation`, `filtres`, `mobile`, `interface`, `abonnements`, `themes`, `generation`, `config`, `deps`… La première ligne fait au plus 80 caractères. Le hook `conventional-pre-commit` vérifie le format en local, et le workflow Quality vérifie chaque commit d'une pull request.

L'historique a été réécrit le 21 novembre 2026 pour suivre cette convention et pour signer tous les commits (#8). Les arbres, les auteurs et les dates sont restés identiques.

## Signature des commits

Tous les commits sont signés. Avec une clé SSH déjà déclarée sur GitHub comme clé de signature :

```bash
git config gpg.format ssh
git config user.signingkey ~/.ssh/<clé>.pub
git config commit.gpgsign true
git config tag.gpgSign true
```

## Contrôles

```bash
mise run check
```

Cette commande lance les hooks sur tout le dépôt, puis les tests JavaScript, Python et navigateur, comme la CI. Les tests navigateur demandent Chrome ou Chromium, et Firefox pour les vérifications multi-navigateurs.

## Sécurité

Une vulnérabilité se signale en privé, jamais dans une issue publique : voir [SECURITY.md](SECURITY.md).
