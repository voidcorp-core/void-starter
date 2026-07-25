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
- Le worktree est propre au commit
  `5fa09ad fix(factory): require explicit GitHub member scope`.

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

Le dépôt distant est encore vide : cette tranche ne pousse pas le code, ne migre pas la base et ne
déploie pas.

## Suite globale

1. Ajouter le push Git, le déploiement Vercel, les migrations/seed et les smoke tests distants.
2. Terminer Better Auth en production.
3. Ajouter le provisioning Expo/EAS.
4. Ajouter R2, Resend, Sentry/PostHog et DNS.
5. Étendre la matrice distante aux profils internal, jobs, documents EU et temps réel.
6. Connecter Forge comme producteur de manifeste et Linear pour le bootstrap projet.
7. Définir les garanties de rollback, le modèle de secrets et la distribution finale du CLI.

Void Harness reste un outil externe de développement et ne doit jamais entrer dans le template ou
le projet généré.
