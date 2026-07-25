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
- Deux mises à jour protégées ont validé le fast-forward, puis le correctif final
  `1153689e0a67695f3c97700baeef566e5ee0e75c` a passé la CI complète et le déploiement
  Vercel Production.

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

Le snapshot initial de 242 fichiers avait pour SHA-256 source
`0d4e9402186becd431162732cc896b92222b70fe2ef81eafebb41e31559d0f75`. Son premier
workflow GitHub Actions a échoué uniquement sur `bun audit` : `eas-cli`, bien qu'inutilisé par la
CI et les exports Expo, ajoutait sept dépendances transitives vulnérables. Le correctif :

- exécute EAS à la demande avec `bunx eas-cli@21.2.0`;
- retire `eas-cli` du lockfile applicatif;
- fixe `uuid` à une version corrigée compatible;
- autorise le `.git` créé par la publication seulement si son receipt est valide.

La première mise à jour protégée a publié
`e32990a756d6acb655abdfcdb8d48ada41d90e39`. Le job qualité a alors tout validé, mais
Playwright ne résolvait pas le `tsconfig` partagé par sous-chemin de package sous Linux. La seconde
mise à jour `ac94c8195a84e6553854db3dd303543c72593a20` a corrigé ce chargement, puis les
tests ont révélé deux défauts fonctionnels : le nom d'accueil attendu était fixe malgré la
personnalisation du projet, et l'inscription envoyait un utilisateur non vérifié vers le
dashboard avant de le renvoyer vers la connexion.

Le correctif final :

- teste le `<h1>` dynamique plutôt qu'un nom de template;
- ajoute `/verify-email/pending` et y dirige les nouveaux comptes;
- fournit en développement un callback de vérification qui journalise le lien;
- échoue explicitement en production tant qu'un vrai expéditeur d'e-mail n'est pas branché.

Il est publié au commit `1153689e0a67695f3c97700baeef566e5ee0e75c`, avec 243 fichiers,
le SHA-256 source `009bfb205194bb3e9bf4486e8d2c05f23841a3bddaf28e434d8f90e6f0136f79`
et une seule tentative. Le workflow GitHub Actions `30151740597` est entièrement vert :

- qualité : audit, lint, type-check, migrations PostgreSQL, tests, builds Next.js et Expo, Knip
  et gitleaks;
- E2E : les neuf scénarios Playwright passent;
- Vercel : déploiement Production `5599957241` réussi sur le même SHA.

L'URL de déploiement est protégée par le SSO Vercel : un smoke anonyme retourne `302` vers
`vercel.com/sso-api`. La compilation et le statut de déploiement sont donc prouvés, mais le smoke
HTTP applicatif doit utiliser un bypass contrôlé ou une URL explicitement publique.

Une inspection finale a aussi montré que `docs/discovery` et `docs/superpowers` étaient copiés
dans l'application. Ils ne contiennent pas de secret, mais appartiennent au développement de la
Factory. La génération et `doctor` les excluent désormais explicitement; cette dernière correction
doit encore être publiée sur le canari.

## Suite globale

1. Publier l'exclusion des documents internes et confirmer une dernière CI verte.
2. Ajouter un receipt d'observation de déploiement et un smoke HTTP avec bypass Vercel contrôlé.
3. Appliquer migrations/seed sur Neon, pas uniquement sur PostgreSQL éphémère en CI.
4. Terminer Better Auth en production : secrets, URL canonique et envoi Resend réel.
5. Ajouter le provisioning Expo/EAS.
6. Ajouter R2, Resend, Sentry/PostHog et DNS.
7. Étendre la matrice distante aux profils internal, jobs, documents EU et temps réel.
8. Connecter Forge comme producteur de manifeste et Linear pour le bootstrap projet.
9. Définir les garanties de rollback, le modèle de secrets et la distribution finale du CLI.

Void Harness reste un outil externe de développement et ne doit jamais entrer dans le template ou
le projet généré.
