# Sandbox canary handoff

> État arrêté le 2026-07-25. Aucun secret n'est enregistré dans ce document.

## État validé

- La factory compose localement un projet Next.js + Expo/EAS piloté par manifeste.
- Le projet généré ne contient ni Void Harness, ni la factory, ni les fichiers de gouvernance
  utilisés pendant le développement.
- La génération, `doctor`, le dry-run, les tests de la factory, le lint et le type-check passent.
- Le preflight réel GitHub/Vercel/Neon passe :
  `b380170501c889c4af41a4078e486936cc03f09bf380285ec802ed29ce9ee39f`.
- `apply:live` a créé les quatre ressources attendues en une tentative chacune.
- `resume:live` a conservé les mêmes IDs et compteurs sans nouvelle mutation.
- Un second projet généré sans état local a adopté les quatre ressources avec les mêmes IDs, sans
  doublon.
- Le code initial a été publié sur `main` au commit
  `86b47407a951d24d83567607219936ba2cf34b59`.
- Le push a retourné une confirmation ambiguë, puis `source:resume` a adopté exactement ce commit
  distant en deuxième tentative, sans second push.

## Sandbox

- GitHub : organisation `void-sandbox`, dépôt canari cible privé.
- Vercel : plan Pro, GitHub App installée sur `void-sandbox`, team ID
  `team_tWTvTTJm5y76mCBcXC7g4P4D`.
- Neon : organization API key, org ID `org-withered-mode-66336948`.
- Régions : Vercel `fra1`, Neon `aws-eu-central-1`.

Les trois credentials existent mais ne sont jamais persistés. À chaque nouvelle session, les
recharger dans le terminal. Le fine-grained GitHub PAT doit cibler `void-sandbox` et posséder :

- Organization permissions — Members: Read-only;
- Repository permissions — Administration: Read and write;
- Repository permissions — Contents: Read and write;
- Repository permissions — Workflows: Read and write.

## Canari local

- manifeste : `/tmp/void-starter-canary-20260725.manifest.yaml`;
- contexte : `/tmp/void-starter-canary-20260725.context.yaml`;
- projet généré : `/tmp/void-starter-canary-20260725`;
- nom : `void-starter-canary-20260725`;
- identifiants natifs : `com.voidsandbox.voidstartercanary`.

Le manifeste correspond à
`tooling/factory/fixtures/manifests/web-expo.yaml`, avec le nom et les identifiants ci-dessus. Le
contexte non secret est :

```yaml
schema_version: 1
github:
  owner: void-sandbox
  owner_kind: organization
  visibility: private
vercel:
  team_id: team_tWTvTTJm5y76mCBcXC7g4P4D
  region: fra1
neon:
  org_id: org-withered-mode-66336948
  region_id: aws-eu-central-1
```

Si `/tmp` a été vidé, reconstruire ces fichiers et relancer `generate`, `doctor`, le dry-run puis
le preflight avant toute mutation.

## Ressources créées

- GitHub repository : `R_kgDOTi-2Vg`;
- Vercel project : `prj_NRGjMkzkuXsF3ppd9Bgd2fPIhkNP`;
- Neon project : `dark-mountain-89324488`;
- Vercel database binding : `4oT3Pp8aD5apDAiv`.

Le projet d'adoption est
`/tmp/void-starter-canary-adoption-20260725`. Son état live confirme les mêmes quatre IDs.
`doctor` passe sur le canari principal et aucun secret ou URI PostgreSQL n'est présent dans son
receipt.

Le dépôt distant contient maintenant le snapshot initial de 242 fichiers, dont le SHA-256 source
est `0d4e9402186becd431162732cc896b92222b70fe2ef81eafebb41e31559d0f75`. Son premier
workflow GitHub Actions a échoué uniquement sur `bun audit` : `eas-cli`, bien qu'inutilisé par la
CI et les exports Expo, ajoutait sept dépendances transitives vulnérables. Le correctif local :

- exécute EAS à la demande avec `bunx eas-cli@21.2.0`;
- retire `eas-cli` du lockfile applicatif;
- fixe `uuid` à une version corrigée compatible;
- autorise le `.git` créé par la publication seulement si son receipt est valide.

Le canari corrigé `/tmp/void-starter-canary-fixed-20260725` passe lint, type-check, tests, Knip,
doctor et les builds Next.js + Expo iOS/Android/Web. Il contient 930 paquets au lieu de 1 200.
La publication contrôlée de cette correction, la CI distante verte, les migrations et les smoke
tests de déploiement restent à terminer.

## Suite globale

1. Ajouter la publication contrôlée des mises à jour, puis obtenir une CI et un déploiement Vercel
   verts sur le canari corrigé.
2. Ajouter les migrations/seed et les smoke tests distants.
3. Terminer Better Auth en production.
4. Ajouter le provisioning Expo/EAS.
5. Ajouter R2, Resend, Sentry/PostHog et DNS.
6. Étendre la matrice distante aux profils internal, jobs, documents EU et temps réel.
7. Connecter Forge comme producteur de manifeste et Linear pour le bootstrap projet.
8. Définir les garanties de rollback, le modèle de secrets et la distribution finale du CLI.

Void Harness reste un outil externe de développement et ne doit jamais entrer dans le template ou
le projet généré.
