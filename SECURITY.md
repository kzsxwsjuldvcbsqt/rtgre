# Politique de sécurité

## Signaler une vulnérabilité

N'ouvrez pas d'issue publique. Utilisez le [signalement privé de GitHub](https://github.com/kzsxwsjuldvcbsqt/rtgre/security/advisories/new) (onglet Security, « Report a vulnerability »).

Décrivez la page ou le fichier concerné, les étapes pour reproduire le problème et son effet. Le signalement reste privé jusqu'à la publication du correctif.

## Périmètre

- le site [rtgre.fr](https://rtgre.fr) et son générateur (ce dépôt) ;
- les workflows GitHub Actions de ce dépôt ;
- l'infrastructure qui le sert, décrite dans [rtgre-platform](https://github.com/kzsxwsjuldvcbsqt/rtgre-platform).

Seule la version en ligne, construite depuis `main`, est maintenue.

## Ce que le site protège

Le site est statique et sans compte. Les notes saisies restent dans le navigateur et ne sont envoyées à aucun serveur. Une faille qui permettrait d'exécuter un script dans la page ou de lire ces notes est donc la plus grave. La politique de sécurité du contenu (CSP) et les analyses automatiques sont décrites dans la section [Sécurité du README](README.md#sécurité).
