# Sandbox canary handoff

> État actualisé le 2026-07-26. Aucun secret n'est enregistré dans ce document.

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
- La source Auth/Resend finale `6c663f667850ca2bf385e0f271f2b9c6eb6cef87` est publiée, la
  base est à jour, les variables Production sont liées, le déploiement est fumé en HTTP 200 et
  l'identité bootstrap réelle accède à `/admin` avec le rôle `admin`.

## Sandbox

- GitHub : organisation `void-sandbox`, dépôt canari cible privé.
- Vercel : plan Pro, GitHub App installée sur `void-sandbox`, team ID
  `team_tWTvTTJm5y76mCBcXC7g4P4D`.
- Neon : organization API key, org ID `org-withered-mode-66336948`.
- Régions : Vercel `fra1`, Neon `aws-eu-central-1`.

Les credentials requis existent mais ne sont jamais persistés. À chaque nouvelle session, les
recharger dans le terminal. Le fine-grained GitHub PAT doit cibler `void-sandbox` et posséder :

- Organization permissions — Members: Read-only;
- Repository permissions — Administration: Read and write;
- Repository permissions — Contents: Read and write;
- Repository permissions — Workflows: Read and write.

## Canari local

- manifeste : `/tmp/void-starter-canary-20260725.manifest.yaml`;
- contexte : `/tmp/void-starter-canary-20260725.context.yaml`;
- projet généré : `/tmp/void-starter-canary-20260725`;
- projet Auth final : `/tmp/void-starter-canary-auth-20260726`;
- contexte Auth non secret : `/tmp/void-starter-canary-20260725.auth.yaml`;
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
Factory. La génération et `doctor` les excluent désormais explicitement.

Cette dernière correction est publiée en un seul fast-forward au commit
`54efeb2c19fc354a333ad262e68482e77c841ec9`, enfant direct de `1153689e`, avec :

- 237 fichiers et 882 429 octets;
- SHA-256 source `aaebae1f24de578bb5649163e3ef61e6b2e93faef8bbd78c01448907b549994a`;
- plan `77c7ef3323152c232368b84e5946c4e56f462cb07616bb47ea8e991b8549df81`;
- workflow GitHub Actions `30152104591` entièrement vert, qualité et E2E;
- déploiement Vercel Production `5600028915` réussi sur le même SHA;
- `doctor` final vert, avec provisioning et publication source valides, documents internes et
  Void Harness absents.

Le smoke anonyme de cette URL finale retourne lui aussi `302` vers le SSO Vercel. La seule limite
de validation du jalon reste donc l'accès HTTP applicatif derrière Deployment Protection, pas le
build ou le déploiement.

Le contrat qui ferme cette limite est désormais implémenté et validé en live. Le plan
`b9c7b565e2dff702c5af745af0560f0b69e93abb1f7a233ce5a5860f3dbb3d39` a lié le commit source exact
au déploiement Production `dpl_EXWCJj38baScgC5BMjADNsHVkf3P`. Le bypass
`VERCEL_AUTOMATION_BYPASS_SECRET`, resté uniquement en mémoire, a permis un smoke HTTP 200 sur
l'URL immuable finale. La réponse HTML de 14 427 octets contient l'identité projet et porte le
SHA-256 `f8b0e7ece95c0564da75d54b22d52ab587c10abd1c1530f43052b94308db4309`.

Le receipt `.void-starter/delivery-state.json` est en mode `0600`, `doctor` est entièrement vert et
le snapshot source reste strictement inchangé : 237 fichiers, 882 429 octets et SHA-256
`aaebae1f24de578bb5649163e3ef61e6b2e93faef8bbd78c01448907b549994a`.

Le lifecycle de migration Neon est également validé en live. Le plan
`cbae8f088dbf96dd666ce202a6b83f48839afb841ff228977b96d217a00bfa11` ciblait le projet
`dark-mountain-89324488` et les quatre migrations du même commit source. Le preflight a observé
zéro migration appliquée; `migration:live` a appliqué les quatre en une tentative puis attesté
`0003_bouncy_mongoose`, SHA-256
`76d7ffa18d3a0f296f4a8d1f89baf7efbc8f63e432b9520ca4b01b5c93237037`, comme dernière entrée.

Le receipt `.void-starter/migration-state.json` est en mode `0600`, `doctor` reste entièrement
vert, et le snapshot source conserve exactement ses 237 fichiers, 882 429 octets et son SHA-256.
La clé Neon et l'URI de connexion n'ont jamais été persistées.

Le jalon Auth production est validé en live sur une nouvelle génération propre. La mise à jour
source protégée a publié le commit `6c663f667850ca2bf385e0f271f2b9c6eb6cef87`, enfant direct de
`54efeb2c19fc354a333ad262e68482e77c841ec9`, avec 243 fichiers, 918 365 octets et le SHA-256
`a50b935b5c84bbe9cea6295caa38e69b2b223daa8eb862c07ef181e0211828cc`. La première confirmation
post-push a relu momentanément l'ancien HEAD et enregistré un conflit; `source:update:resume` a
adopté le commit déjà distant en deuxième tentative, sans second push. Le correctif Factory
`7ada6af` reproduit désormais ce cas comme `GITHUB_SOURCE_PUSH_UNCONFIRMED` réessayable.

Le nouveau plan migration `31bad67dc61fe350570af07c18a35213e84a9bcb043f9f87611157c476bd93b0`
a observé les quatre migrations présentes et zéro en attente, puis a écrit une attestation liée au
nouveau commit sans modifier le schéma. Le plan Auth
`d35ef5db9e8e88a03927719f9546ae561d9cda8f53135363b8670a4fbb7c8e97` a ensuite :

- lié huit variables Vercel Production, dont `BETTER_AUTH_SECRET` et `RESEND_API_KEY` en
  Sensitive;
- utilisé le domaine Resend vérifié `updates.voidcorp.io` et envoyé avec succès l'e-mail de
  configuration à l'identité bootstrap;
- persisté uniquement le marker Vercel `Dz0dYmRJpxfxJOiP`, l'email Resend
  `5c2c2fe8-254a-4f18-a5f7-4ca2fe38faaa` et les métadonnées non secrètes;
- conservé `.void-starter/auth-state.json` en mode `0600`, `doctor` vert et le snapshot source
  inchangé.

Après redéploiement sans cache, le plan delivery
`6909d344721ad2acb91dbb2680db56d99aad3dcec646e8961ffb16c508474382` a lié le même commit au
déploiement `dpl_E7Z6Y9pjS9ETrUy3qKHavhBFN4M3`. Le smoke protégé a obtenu HTTP 200 HTML, 14 427 octets
et le SHA-256 `ed659bc1a2b3aa99471434b92e3e9c57fdd4e8c8e1c05878a1910372ea652fe0`.
Enfin, un magic link réel a créé l'identité exacte, établi la session puis autorisé `/admin` avec
le rôle `admin`. Aucun lien d'authentification, token fournisseur ou secret n'a été persisté.

## Suite globale

1. Exécuter le canary isolé du provisioning Expo/EAS désormais implémenté, puis publier le lien
   EAS par un source update gardé.
2. Ajouter R2, Sentry/PostHog et DNS; Resend est terminé.
3. Étendre la matrice distante aux profils internal, jobs, documents EU et temps réel.
4. Connecter Forge comme producteur de manifeste et Linear pour le bootstrap projet.
5. Définir les garanties de rollback, le modèle de secrets restant et la distribution finale du
   CLI.

Void Harness reste un outil externe de développement et ne doit jamais entrer dans le template ou
le projet généré.
