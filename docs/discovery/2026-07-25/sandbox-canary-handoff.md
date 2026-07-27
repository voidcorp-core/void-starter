# Sandbox canary handoff

> État actualisé le 2026-07-27. Aucun secret n'est enregistré dans ce document.

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
- Le projet EAS `@void-sandbox/void-starter-canary-20260725` est créé et vérifié, son lien public
  non secret est publié au commit `eb7c7db9ff64fed96d7c0f9c85f541f124f11bdb`, la CI complète
  est verte et le déploiement exact passe le smoke Production protégé en HTTP 200.

## Sandbox

- GitHub : organisation `void-sandbox`, dépôt canari cible privé.
- Vercel : plan Pro, GitHub App installée sur `void-sandbox`, team ID
  `team_tWTvTTJm5y76mCBcXC7g4P4D`.
- Neon : organization API key, org ID `org-withered-mode-66336948`.
- Régions : Vercel `fra1`, Neon `aws-eu-central-1`.

Les credentials fournisseur utilisés par la Factory sont désormais conservés dans le trousseau
macOS et chargés uniquement en mémoire par les commandes. GitHub utilise également son entrée de
trousseau persistante. `EXPO_TOKEN` reste le seul credential de cette matrice qui n'est pas encore
enregistré. Le fine-grained GitHub PAT doit cibler `void-sandbox` et posséder :

- Organization permissions — Members: Read-only;
- Repository permissions — Administration: Read and write;
- Repository permissions — Contents: Read and write;
- Repository permissions — Workflows: Read and write.

## Canari local

- manifeste : `/tmp/void-starter-canary-20260725.manifest.yaml`;
- contexte : `/tmp/void-starter-canary-20260725.context.yaml`;
- projet généré : `/tmp/void-starter-canary-20260725`;
- projet Auth final : `/tmp/void-starter-canary-auth-20260726`;
- projet EAS final : `/tmp/void-starter-canary-eas-20260726`;
- contexte Auth non secret : `/tmp/void-starter-canary-20260725.auth.yaml`;
- contexte EAS non secret : `/tmp/void-starter-canary-20260725.eas.yaml`;
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

Le jalon Expo/EAS est également validé en live. Le plan
`13be128d263c22b0a544bb42ffc9efe3fc173a6b1d80e33fbf5281ed1111bfe0` a utilisé le robot
`Developer` de `void-sandbox` pour créer et relire
`@void-sandbox/void-starter-canary-20260725`, UUID
`a37e6150-91af-461c-9d4f-ebf6ef100088`. Les deux premières tentatives ont révélé que le projet
temporaire EAS devait posséder un `package.json` minimal et ne contenir que la configuration
d'identité, sans plugins d'exécution. Les correctifs `92e72c8` et `e138601` couvrent ces cas,
redactent le diagnostic fournisseur en mémoire et conservent un état persistant générique sans
secret. La troisième tentative a réussi avec le lien SHA-256
`5fae99a26059ec7ce3ac22b94e546b17e73fd53c55b1c17c50b87bcac285ba18`.

La génération fraîche a ensuite adopté les quatre ressources historiques sans doublon. Le plan
source `4892cce9bfc208c87e69b2f4e627d2b1e6876b905de8a6722a961b2d9b2119d8` a publié 245 fichiers,
923 574 octets et le SHA-256
`002b398b9f164d4a893df4eae1926107a5f39f351a23b7c5a00500e590434a34` au commit
`eb7c7db9ff64fed96d7c0f9c85f541f124f11bdb`. GitHub a d'abord retourné une confirmation
post-push ambiguë; `source:update:resume` a adopté le commit exact en deuxième tentative, sans
second push. Le workflow `30207323123` a validé les jobs qualité et E2E, dont le build Expo réel.

Enfin, le plan delivery `95f7f8d23ed81b4271d18fe93a5f2dd717e5cb0b6ed93bb85149b7038416ff9a`
a lié ce commit au déploiement `dpl_dSKnNMRMEXsWwnoSxBKD7jx2Hxh7`. Le smoke protégé a obtenu
HTTP 200 HTML, 14 427 octets et le SHA-256
`69db3fd50b062fa2ae9c20054870cc996efcceb3f9b10dd5f94fcbf267479fd5`. `doctor` valide
simultanément les reçus EAS, provisioning, source et delivery; le lien EAS est public, mais les
tokens Expo/Vercel/GitHub et le bypass restent absents de la source et des reçus.

## R2 validé

`DEV-467` est fermé dans le projet Linear `Void Starter`. Le canari isolé a validé le plan
`7a7be8babbdb8240ca34e7855bff008cf7f4302b85b0dbfd6797cd771afb0770` le 2026-07-27 :

- bucket `void-starter-canary-20260725`, ID `f520e89b2e934d96a7b4275140e122b7`, compte
  `afec34d4c8f123c2235386929f2dcfee`, juridiction `eu`, accès public désactivé;
- upload/read/delete exact, objet supprimé et digest du payload
  `ac59473e043aa0897c106b119fc8a505c74570acff654112a5c07f3759dd228e`;
- liaison Vercel `ERMGEG72S7cCdvST` pour les cinq clés runtime attendues, sans valeur secrète dans
  l'état Factory;
- premier apply volontairement suspendu avant la liaison, puis reprise réussie après création de
  credentials Object Read & Write limités au bucket exact;
- reprise d'un état déjà terminé sans nouvel appel de mutation ni changement des compteurs
  `1,1,1,1,2,2`;
- adoption depuis `/tmp/void-starter-canary-r2-adoption-20260727` sans état préalable : mêmes six
  IDs fournisseur et compteurs `1,1,1,1,1,1`, donc aucun doublon;
- états en mode `0600`, `doctor` vert et aucun token ou secret persisté.

Le premier appel objet réel avait retourné HTTP 501 parce que le client envoyait du multipart. Le
payload est désormais envoyé brut en `application/octet-stream`, et le mock HTTP impose cette
forme pour prévenir la régression. Les deux tokens Cloudflare créés pour ce canari expirent après
sept jours : révoquer le token de contrôle après validation et conserver/faire tourner le token
runtime uniquement si le sandbox doit continuer à accéder au bucket.

## Sentry validé

`DEV-466` est terminé dans Linear. Le canari isolé a validé le plan
`7cacd9647fd4dd1188fadb68ee783d0a144753589cedcbafa4e27622b59577e0` le 2026-07-27 :

- préflight vert sur GitHub, Vercel, Neon, Cloudflare et l'organisation Sentry active
  `void-corp-md` en région `de`, équipe `void-corp`;
- adoption des six ressources historiques sans changement d'ID;
- création du projet Next.js Sentry `void-starter-canary-20260725`, ID `4511807245516880`, clé
  client `55f31207fd9b8307ee94f6a34bd79741`;
- premier apply arrêté volontairement sur `SENTRY_BUILD_AUTH_TOKEN_MISSING`, puis reprise avec le
  token build séparé et liaison Vercel `hHSyb6KDUXFU6K7I` pour les cinq clés attendues;
- reprise d'un état terminé sans changement des compteurs `1,1,1,1,1,1,1,2`;
- adoption depuis `/tmp/void-starter-canary-sentry-adoption-20260727` : mêmes huit IDs et une
  tentative par action, donc aucun doublon;
- deux `doctor` verts, états en mode `0600`, aucun des huit credentials du trousseau ni DSN public
  présent dans les reçus.

## PostHog validé

`DEV-468` est prêt à être terminé dans Linear. Le canari isolé a validé le plan
`9d7a61823147d36f96447c98243cf0a8cab052f00b4e2b9b4e516b6c0a691617` le 2026-07-27 :

- préflight vert sur les six fournisseurs et l'organisation PostHog EU `Void Corp`
  (`019d9316-714e-0000-01c7-e9a08d38242b`);
- adoption des huit ressources historiques sans changement d'ID;
- création unique du projet PostHog `void-starter-canary-20260725`, ID `233588`;
- correction du validateur après observation d'un ID d'organisation hexadécimal UUID-shaped mais
  sans version/variante RFC, puis reprise sans second `POST` projet;
- liaison Vercel `KHP1Sghuyxh0KK7M` pour `NEXT_PUBLIC_POSTHOG_KEY` et
  `NEXT_PUBLIC_POSTHOG_HOST=/ingest`;
- reprise terminée avec compteurs `1,1,1,1,1,1,1,1,2,1`, puis adoption fraîche des dix mêmes IDs
  avec une tentative par action;
- deux `doctor` verts, états en mode `0600`, aucune correspondance avec les neuf credentials, le
  DSN Sentry ou la clé projet PostHog.

## Matrice transverse DEV-471

La matrice sans DNS propriétaire a été rejouée le 2026-07-27 sur une génération fraîche. Le plan
`9d7a61823147d36f96447c98243cf0a8cab052f00b4e2b9b4e516b6c0a691617` a adopté en une tentative
chacune les dix ressources GitHub, Vercel, Neon, R2, Sentry et PostHog existantes. Aucun domaine,
record DNS ou nameserver n'a été lu ou modifié.

La mise à jour finale a publié 245 fichiers et le SHA-256 source
`8fdb9f6b11d23cc2af72eff570c13e22d8a31c185662d0d575b8ca7bcec84f6e` au commit
`b72382505f6205d7e24a90a1b30970ca88fa604c`. Une confirmation post-push momentanément ambiguë a
été réconciliée par `source:update:resume` sans second commit. Le plan migration
`dc50d7ff981af94ef0070fd57fce5bd8f51a6705da246dc585c26d4620808d41` a relié ce commit aux quatre
migrations Neon déjà appliquées, avec zéro migration en attente.

Le plan delivery `85e2c6d26db0b6889d5b6cf131d77082c4a34b669068e9f9bbe8024506440957`
a observé le déploiement Production `dpl_HVZjYCnsVvNBobF8kDPbcAN4QkMZ` en état `READY`. Le bypass
d'automatisation Vercel, stocké séparément dans le trousseau, a permis un smoke HTTP 200 sur l'URL
immuable `.vercel.app`; la réponse HTML contient 14 427 octets et porte le SHA-256
`0f81e1128efc3013ddd63fe0a4e2eef9986a53e7aed723db4c72ff3614b393ca`.

La matrice locale passe lint, type-check, tests, Knip, build Next.js et exports Expo iOS, Android et
Web. Le replay a aussi révélé qu'un outil chargeant directement `app.config.ts` peut fournir une
configuration Expo vide. Le générateur relit désormais `app.json` dans ce cas, ce qui préserve le
lien EAS et rend Knip déterministe; un test de génération couvre ce chemin.

Le workflow GitHub Actions `30279121369` est entièrement vert sur ce même commit : le job qualité
valide audit, lint, type-check, migrations, tests, builds, Knip et gitleaks; le job E2E valide les
scénarios Playwright.

Le seul contrôle restant est le reçu opérationnel EAS de cette génération fraîche : le lien public
existe et le projet EAS historique est valide, mais `doctor` refuse à juste titre un lien sans reçu
lié au nouveau hash de configuration. Il faut enregistrer un `EXPO_TOKEN`, relancer
`eas:preflight` puis `eas:live`, republier ce receipt-owned overlay et rejouer `doctor`. Aucun reçu
historique ne doit être copié.

## Suite globale

L’adaptateur Cloudflare DNS est désormais implémenté et contract-testé sur la branche dédiée. Il
ajoute le domaine projet Vercel puis un CNAME DNS-only possédé par commentaire, matérialise les
challenges TXT Vercel, attend `verified=true` et `misconfigured=false`, reprend la propagation sans
recréation et refuse les enregistrements étrangers, les upgrades payants et tout changement de
nameserver. Le canari live sur une zone isolée reste à exécuter avant de clore `DEV-469`.

1. Revalider le reçu EAS de la matrice transverse avec un `EXPO_TOKEN` persistant.
2. Valider DNS en live lorsqu'une zone dédiée existe; cette étape est volontairement différée et
   ne bloque pas le dogfood sur `.vercel.app`.
3. Étendre la matrice distante aux profils internal, jobs, documents EU et temps réel.
4. Connecter Forge comme producteur de manifeste et Linear pour le bootstrap projet.
5. Définir les garanties de rollback, le modèle de secrets restant et la distribution finale du
   CLI.

Void Harness reste un outil externe de développement et ne doit jamais entrer dans le template ou
le projet généré.
