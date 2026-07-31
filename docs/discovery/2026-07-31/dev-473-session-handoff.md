# Handoff DEV-473 : profil documents privés EU

> Rédigé le 2026-07-31 pour permettre la reprise en session fraîche. Aucun secret n'est enregistré
> dans ce document.

## Ce qui est terminé

`DEV-474` est fermé. La PR #19 est fusionnée dans `main` au merge commit `1e82f02`, CI verte. Le
contrat invite-only est prouvé sur la Production du canari interne : un invité qui ouvre réellement
`/invite/<token>` est admis, la même invitation sans le lien est refusée en 422 sans consommer
l'invitation. Les détails sont dans le handoff canari du 2026-07-25.

## Où en est DEV-473

Branche `agent/dev-473-eu-private-documents`, PR #20 ouverte, CI verte sur `2c3c8b1`. Sept commits :

1. `73b7ec4` module `@repo/storage-r2` : port `ObjectStorage`, adaptateur R2, ledger, règles;
2. `60c9fa4` surfaces `apps/web` : quatre actions, page, uploader, listing;
3. `d227cd8` composition factory depuis `data.files`, fixture `web-eu-documents.yaml`, tests;
4. `222518f` action de provisioning `cloudflare.r2-cors`;
5. `f387d8d` suite d'intégration contre le vrai ledger (ADR 66);
6. `2c3c8b1` ADR 68 et 69, spec E2E, docs;
7. `a59dd00` vérification de portée des credentials R2 avant liaison.

Le jalon s'est révélé être de la construction, pas de la validation : le port `ObjectStorage` que
`docs/FACTORY.md` décrivait n'existait nulle part, donc `DEV-467` avait provisionné un bucket
qu'aucun code applicatif ne pouvait atteindre.

## Le canari live, interrompu

Pile neuve créée sur le sandbox, six ressources en une tentative chacune :

- GitHub `R_kgDOToADxw` (`void-sandbox/void-starter-canary-documents-20260730`);
- Vercel `prj_4UdpUNdipa8N7OrOOlG7ubtnwEZ3`, région `fra1`;
- Neon `ancient-star-99013596`, région `aws-eu-central-1`;
- liaison `DATABASE_URL` `gIEaggFcbOqoeTfV`;
- bucket R2 `4cbb9b10edad4a5f895e93cd7cb08ac5`, compte `afec34d4c8f123c2235386929f2dcfee`,
  juridiction `eu`;
- règle CORS posée **et relue**, origine `http://localhost:3000`.

L'apply s'est arrêté sur `vercel.r2-binding`, d'abord en `R2_RUNTIME_CREDENTIAL_MISSING` (voulu :
lancé sans la paire runtime), puis en `R2_RUNTIME_CREDENTIAL_SCOPE` après dépôt d'un token.

**Point de blocage.** Le token déposé dans le trousseau
(`void-starter-r2-documents-access-key-id` / `...-secret-access-key`) est valide mais scopé au
mauvais bucket. Vérifié avec le SDK AWS sur les deux buckets : 403 sur
`void-starter-canary-documents-20260730`, 200 sur `void-starter-canary-20260725`. Les formes sont
correctes (Access Key ID hex 32, Secret hex 64) et les valeurs diffèrent des entrées historiques,
donc c'est bien un token neuf dont le *Specify bucket* pointe sur le mauvais bucket.

Reprise : recréer le token scopé à `void-starter-canary-documents-20260730`, remplacer les deux
entrées du trousseau, puis

```
VOID_R2_KEY_ENTRY=void-starter-r2-documents-access-key-id \
VOID_R2_SECRET_ENTRY=void-starter-r2-documents-secret-access-key \
  <scratchpad>/factory-live.sh ./src/resume-live.cli.ts \
  /tmp/void-starter-canary-documents-20260730 \
  /tmp/void-starter-canary-documents-20260730.context.yaml \
  --confirm-project void-starter-canary-documents-20260730
```

Puis : `source:live`, `migration:live`, attendre la CI du dépôt canari, le plan auth, le déploiement,
`delivery:live`, et enfin la preuve live du flux document. L'origine de Production devra être ajoutée
à `browser_origins` dans le contexte une fois l'URL canonique connue, ce qui rejouera l'action CORS.

Artefacts sous `/tmp/void-starter-canary-documents-20260730{,.manifest.yaml,.context.yaml}`. Le
wrapper `factory-live.sh` du scratchpad de session charge les credentials du trousseau et accepte
`VOID_R2_KEY_ENTRY` / `VOID_R2_SECRET_ENTRY` pour cibler d'autres entrées.

## Ce que le canari a déjà trouvé

Trois défauts réels, tous corrigés dans `a59dd00`, aucun dans le code produit :

- **la liaison R2 ne vérifiait pas la portée des credentials.** Le canari objet du bucket passe par
  l'API Cloudflare avec le token de contrôle, donc rien n'exerçait jamais la paire runtime. Un token
  scopé ailleurs se liait proprement : neuf actions vertes, `doctor` vert, et une application
  incapable d'écrire un seul objet. Le premier échec visible aurait été un 403 sur l'upload d'un
  utilisateur, sans rien dans les reçus pour l'expliquer;
- **`#request` attachait le Bearer du fournisseur à toute requête**, donc la requête S3 signée
  partait avec le token de contrôle Cloudflare en plus de sa signature AWS4, vers un hôte qui n'a
  aucune raison de le voir;
- **`validateProvisioningState` retombait sur `'project'`** par défaut dans une chaîne de ternaires.
  Une action nouvelle dont la ligne est oubliée produisait un apply dont l'état était rejeté au
  resume suivant, ce qui est exactement comme l'action CORS a été découverte. C'est désormais un
  `Record` exhaustif : la même omission devient une erreur de compilation.

## Le fichier de findings void-music

`docs/discovery/2026-07-30/void-music-provisioning-findings.md` (non suivi par git) recense neuf
points relevés pendant le provisioning réel de `voidcorp-core/void-music` : neuf actions réussies,
mais huit allers-retours de diagnostic manuel. Le handoff canari du 2026-07-25 a déjà été complété
d'un pointeur vers ce document, également non commité.

Ordre de traitement recommandé par le document lui-même :

1. **point 0** — remonter le corps des réponses d'erreur des fournisseurs. Plus fort levier :
   Cloudflare, Sentry et Vercel nomment tous la cause exacte dans un corps que la factory jette,
   pour ne remonter que `<provider>_HTTP_<status>`. Corriger ce point réduit à lui seul le coût des
   points 2, 3 et 4;
2. **points 1, 2, 4, 7** — preflights et documentation : scopes Sentry non documentés,
   `allowMemberProjectCreation` lisible au preflight mais non vérifié, accès de l'intégration Git de
   Vercel au namespace non vérifié, permission `Workflows: Read and write` requise par tout projet
   généré mais absente de la documentation;
3. **point 6** — dépôt créé sans commit initial, à reproduire sur un dépôt neuf avant conclusion :
   le canari du 25 a vu `source:resume` réconcilier avec succès, donc le chemin nominal fonctionne
   au moins parfois;
4. **points 5 et 8** — confort : procédure de replan après changement de fixture, et `@repo/notes`
   présent dans tout projet généré.

Deux d'entre eux recoupent directement ce qui vient d'être corrigé ici. Le point 0 aurait rendu le
diagnostic du token mal scopé immédiat plutôt que déductif, et le point 2 est le même motif que la
vérification de portée ajoutée dans `a59dd00` : un contrôle possible au preflight qu'on laisse
échouer à l'apply.

## État de l'arbre de travail

Non commités et volontairement laissés en l'état, car issus d'un autre fil de travail :

- `docs/discovery/2026-07-30/void-music-provisioning-findings.md` (nouveau);
- la section ajoutée en fin de `docs/discovery/2026-07-25/sandbox-canary-handoff.md`.

Tout le reste est commité et poussé sur `agent/dev-473-eu-private-documents`.

## Vérifications qui passent

Lint, type-check, tests (158 pour la factory, 28 pour le module storage dont 5 d'intégration), Knip
et build sur le dépôt. Les deux profils générés, avec et sans R2, passent leur propre `lint`,
`type-check`, `test`, `knip`, `build` et `doctor`. La suite d'intégration a été validée contre un
Postgres jetable local avant push, plutôt qu'en attendant la CI.
