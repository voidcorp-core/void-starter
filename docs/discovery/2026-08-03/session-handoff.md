# Handoff — 2026-08-03

> **Remplacé par [`../2026-08-04/session-handoff.md`](../2026-08-04/session-handoff.md)**, qui est
> le point de reprise à jour. Ce document reste exact sur le détail du canari, des tickets DEV-556 et
> DEV-557 et de l'audit, mais décrit la PR #20 comme ouverte alors qu'elle est fusionnée.
>
> Remplace lui-même `../2026-07-31/dev-473-session-handoff.md`, qui reste valable pour le détail du
> canari mais ignore tout ce qui a suivi. Aucun secret ici.

## En une ligne

DEV-474 est fermé et fusionné. DEV-473 est en revue avec sa PR verte, son canari live arrêté sur un
token R2 mal scopé. Deux tickets de fond ont été ouverts (DEV-556, DEV-557) et un audit des trois
projets a été produit.

## 1. DEV-473 — profil documents privés EU

Branche `agent/dev-473-eu-private-documents`, **PR #20** ouverte, CI verte sur `2113af4`
(`quality` + `e2e`), `MERGEABLE` / `CLEAN`.

Neuf commits. Le module `@repo/storage-r2` (port `ObjectStorage`, adaptateur R2, ledger, règles),
les surfaces `apps/web`, la composition factory depuis `data.files`, l'action de provisioning
`cloudflare.r2-cors`, la suite d'intégration contre le vrai ledger, les ADR 68 et 69, la
vérification de portée des credentials R2, puis les correctifs d'alignement harness et l'audit.

Le jalon s'est révélé être de la construction et non de la validation : le port `ObjectStorage` que
`docs/FACTORY.md` décrivait n'existait nulle part, donc DEV-467 avait provisionné un bucket
qu'aucun code applicatif ne pouvait atteindre.

### Le canari, en pause

Pile neuve, six ressources créées en une tentative chacune :

| Ressource | Identifiant |
|---|---|
| GitHub | `R_kgDOToADxw` (`void-sandbox/void-starter-canary-documents-20260730`) |
| Vercel | `prj_4UdpUNdipa8N7OrOOlG7ubtnwEZ3`, `fra1` |
| Neon | `ancient-star-99013596`, `aws-eu-central-1` |
| Liaison `DATABASE_URL` | `gIEaggFcbOqoeTfV` |
| Bucket R2 | `4cbb9b10edad4a5f895e93cd7cb08ac5`, compte `afec34d4c8f123c2235386929f2dcfee`, juridiction `eu` |
| Règle CORS | posée **et relue**, origine `http://localhost:3000` |

**Bloqué sur `vercel.r2-binding`**, code `R2_RUNTIME_CREDENTIAL_SCOPE`. Le token déposé dans le
trousseau est valide mais scopé au mauvais bucket : vérifié avec le SDK AWS, 403 sur
`void-starter-canary-documents-20260730`, 200 sur `void-starter-canary-20260725`. Les formes sont
bonnes et les valeurs diffèrent des entrées historiques, donc c'est un token neuf dont le
*Specify bucket* pointe ailleurs.

**Action requise de l'opérateur** : recréer le token R2 Object Read & Write scopé à
`void-starter-canary-documents-20260730`, remplacer les deux entrées
`void-starter-r2-documents-access-key-id` et `void-starter-r2-documents-secret-access-key`, puis :

```
VOID_R2_KEY_ENTRY=void-starter-r2-documents-access-key-id \
VOID_R2_SECRET_ENTRY=void-starter-r2-documents-secret-access-key \
  <scratchpad>/factory-live.sh ./src/resume-live.cli.ts \
  /tmp/void-starter-canary-documents-20260730 \
  /tmp/void-starter-canary-documents-20260730.context.yaml \
  --confirm-project void-starter-canary-documents-20260730
```

Ensuite : `source:live`, `migration:live`, CI du dépôt canari, plan auth, déploiement,
`delivery:live`, puis la preuve live du flux document. L'origine de Production devra rejoindre
`browser_origins` une fois l'URL canonique connue, ce qui rejouera l'action CORS.

Artefacts sous `/tmp/void-starter-canary-documents-20260730{,.manifest.yaml,.context.yaml}`.

### Ce que le canari a trouvé, tout corrigé

- **la liaison R2 ne vérifiait pas la portée des credentials** : un token scopé ailleurs se liait
  proprement, laissant neuf actions vertes et une application incapable d'écrire un objet;
- **`#request` attachait le Bearer du fournisseur à toute requête**, donc la requête S3 signée
  partait avec le token de contrôle Cloudflare en plus de sa signature AWS4;
- **`validateProvisioningState` retombait sur `'project'`** par défaut, si bien qu'une action
  nouvelle sans sa ligne produisait un état rejeté au resume suivant. C'est un `Record` exhaustif
  désormais : l'omission devient une erreur de compilation.

Aucun de ces trois n'était dans le code produit.

## 2. Tickets ouverts

**[DEV-556](https://linear.app/voidcorp/issue/DEV-556)** — séparer ce que la génération ignore de ce
que `doctor` interdit. `doctor` déclare aujourd'hui interdits, chez `void-music`, le `CLAUDE.md` du
consommateur, son `.mcp.json`, son `.git` et l'état du harness. Une constante sert deux rôles;
`.git` a déjà son exception ad hoc. Piège noté : `excluded_source_paths` est gravé dans chaque reçu
et recomparé par `doctor`, donc toute modification invalide les reçus émis.

**[DEV-557](https://linear.app/voidcorp/issue/DEV-557)** — regrouper l'état des outils voidcorp sous
`.void/`. Bloqué par DEV-556. Cible `.void/{harness,starter,forge}`. Faisabilité vérifiée : le
déplacement est sûr (aucun fichier du dossier n'est dans les digests), la liste d'exclusions gravée
impose la tolérance de DEV-556, et le préfixe `void-starter:v1:` des clés d'idempotence ne doit pas
bouger. À faire après la fermeture de DEV-473.

## 3. Audit des trois projets

`ecosystem-audit.md`, dans ce même dossier. Trois conclusions :

- `docs/ECOSYSTEM-CONTRACTS.md` existe chez Forge et couvre les contrats de données, pas les
  chemins. Sept racines pour trois outils, dont `.void-starter/` où **Forge** écrit aussi;
- le handshake Forge → Starter n'est rejouable nulle part : `consumer-check` échoue sur un
  `.void-forge/artifacts` absent, aucun run n'existe, aucune CI ne l'exerce. `docs/FACTORY.md`
  affirme pourtant que la dérive est testée contre la sortie réelle de Forge, alors que le test
  construit sa propre fixture;
- le motif preview/apply/receipt/resume a été redécouvert trois fois, avec trois `doctor`.

Recommandation : ne pas fusionner, et donner au document existant la carte des chemins qui lui
manque.

## 4. Alignement harness — où ça en est

Le harness a avancé de son côté pendant la session. Sur son `main` :

- `86f7606 fix(install): read the project root, not the staging directory, when checking lint`
- `452751e fix(install): delete the lint auto-repair, which could have switched a project's linter off`

**Les deux points que j'avais laissés côté harness sont donc traités**, et par la bonne décision :
il n'écrit plus dans le `biome.json` du consommateur. Son message de commit cite la documentation
Biome — « when using a negated pattern, you should always specify `**` first, otherwise the negated
pattern will not match any files ».

### Un point à surveiller ici, conséquence directe

Notre `biome.json` porte `"includes": ["!.claude"]`, c'est-à-dire exactement la négation seule que
la documentation déconseille. Vérifié : le lint fonctionne quand même — un fichier fautif déposé
hors `.claude` est bien signalé, et 337 fichiers sont vérifiés — parce que le `**` vient de
`packages/config/biome.base.json` par `extends`. Vérifié aussi : écrire `["**", "!.claude"]`
explicitement ne tient pas, Biome le réduit lui-même à `["!.claude"]` au formatage.

La protection tient donc à l'héritage. Si quelqu'un retire l'`extends` ou vide les `includes` de la
base, le lint cesse silencieusement de vérifier quoi que ce soit. Un test de non-régression qui
prouve que le lint détecte encore une faute vaudrait mieux qu'un commentaire, et n'existe pas.

## 5. Fichier de findings void-music

`../2026-07-30/void-music-provisioning-findings.md`, toujours non suivi par git, neuf points relevés
pendant le provisioning réel de `voidcorp-core/void-music`. Ordre de traitement recommandé par le
document : point 0 (remonter le corps des erreurs fournisseur, plus fort levier), puis 1, 2, 4, 7
(preflights et documentation), puis 6 (dépôt sans commit initial, à reproduire), puis 5 et 8.

Le point 0 aurait rendu immédiat le diagnostic du token mal scopé, qui a demandé une sonde manuelle
sur deux buckets.

## 6. État de l'arbre

Non commités, issus d'un autre fil, volontairement laissés :

- `docs/discovery/2026-07-30/void-music-provisioning-findings.md`;
- la section finale de `docs/discovery/2026-07-25/sandbox-canary-handoff.md`.

Tout le reste est poussé sur `agent/dev-473-eu-private-documents`.

## 7. Reprise, dans l'ordre

1. token R2 correctement scopé, puis `resume:live` et la suite du canari;
2. preuve live du flux document, mise à jour du handoff canari, fermeture de DEV-473 et de la PR #20;
3. DEV-556, puis DEV-557;
4. findings void-music, en commençant par le point 0.

## Vérifications au moment d'écrire

Lint 337 fichiers, type-check 13 packages, 13 tâches de test sans cache et au `testTimeout` par
défaut. CI verte sur `2113af4`, jobs `quality` et `e2e`. En CI, les suites gardées tournent bien :
`storage.integration` 5 tests, `invite-only-http.integration` 3, `invitation.repository.integration`
9, `auth.integration` 2, `users.integration` 2.

Note : la suite de la factory devient instable à `testTimeout: 5000` sous forte charge machine —
observé à 203 de load average, verte à 159/159 avec `--testTimeout=60000` et verte au défaut une
fois la charge retombée. Le défaut mérite d'être relevé, dans un changement à part.
