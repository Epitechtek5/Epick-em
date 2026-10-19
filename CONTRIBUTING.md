# Contribuer

0. Une seule fois après le clone : `pipx install pre-commit && make hooks` (bloque les commits contenant un secret).
1. Créer ou choisir une issue sur le tableau GitHub Projects.
2. Créer une branche depuis `main` : `<type>/<numéro>-description` (ex. `feat/12-pickem-resolution`).
3. Commits au format [Conventional Commits](https://www.conventionalcommits.org/fr/) (`feat:`, `fix:`, `chore:`…) : ils déterminent la prochaine version (semantic-release). En cas de squash merge, c'est le titre de la PR qui compte : il doit donc respecter ce format.
4. Ouvrir une pull request qui référence l'issue (`Closes #12`). Le check `ci-ok` doit être vert avant le merge.

Avant de pousser :

```sh
make lint
make test
```

Une décision d'architecture se documente par un ADR dans [`docs/adr/`](docs/adr/README.md).
