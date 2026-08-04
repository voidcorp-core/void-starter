# Handoff -- 2026-08-04

> Point de reprise à jour. Remplace [`../2026-08-03/session-handoff.md`](../2026-08-03/session-handoff.md),
> qui reste valable sur le détail du canari, des tickets DEV-556/557 et de l'audit. Aucun secret ici.

## En une ligne

Les trois PR ouvertes sont fusionnées, `main` est à `a2f4b83`, plus rien n'est en attente sur le
dépôt. DEV-473 reste **In Progress** : le code est dans `main`, le canari du starter ne l'a toujours
pas traversé.

## 1. Ce qui a été fusionné, et dans quel ordre

| PR | Contenu | Merge |
|---|---|---|
| #21 | `fix(storage-r2)`: endpoint composé avec la juridiction | `aa706d9`, dans la branche DEV-473 |
| #20 | `feat(storage)`: profil documents privés EU | `95a45d0`, dans `main` |
| #22 | `chore(deps)`: bump hebdomadaire | `a2f4b83`, dans `main` |

L'ordre n'était pas libre. #21 devait précéder #20 : sans elle, `storage.object-store.ts` compose
`https://<account>.r2.cloudflarestorage.com`, hôte qui refuse un bucket à juridiction, donc `main`
aurait reçu un module mort pour précisément les buckets que le profil sert.

#22 a été mise à jour par un merge de `main` plutôt que par un rebase, pour éviter un force-push.
Un seul conflit, `biome.json` : la branche montait le `$schema` en 2.5.6, `main` ajoutait
`files.includes`. Les deux sont conservés. Le lockfile a été régénéré par `bun install` au lieu de
faire confiance à l'auto-merge textuel, puisque `main` apportait `@repo/storage-r2` et ses
dépendances que ce lock n'avait jamais vues.

### Sur la levée du garde-fou de la PR #20

Le corps de #20 portait « do not merge before that round trip ». Ce n'est pas une dérogation : la
preuve live existe, elle vient d'ailleurs. `voidcorp-core/void-music`, projet réel généré depuis ce
starter contre un vrai bucket EU, a traversé le flux complet -- authorize, PUT direct, confirm, list,
download, erase -- suite e2e à 22/22. C'est ce run qui a produit #21. Tracé en commentaire sur la PR.

Ce que ce merge **ne** prouve pas : le canari du starter, lui, n'a jamais atteint le flux document.

## 2. Dette documentaire du merge, traitée ici

#21 a été fusionnée sans sa documentation, ce qui contredit la méta-règle du dépôt. Rattrapé :

- **ADR 70** dans `docs/DECISIONS.md` : la résolution de l'endpoint, ses alternatives écartées, et
  le fait que le chemin de composition n'est jamais porteur à l'intérieur de la factory;
- `_modules/storage-r2/README.md` affirmait `<ACCOUNT_ID>.r2.cloudflarestorage.com` comme l'hôte
  des URLs présignées. C'était exactement l'énoncé qui a coûté des heures dans void-music, réaffirmé
  par notre propre documentation. Corrigé, avec le symptôme trompeur nommé;
- la liste des variables du module ne portait ni `R2_ENDPOINT` ni `R2_JURISDICTION`, dans les trois
  endroits qui l'énumèrent : le README du module, `_modules/README.md`, `docs/MODULES.md`.

À noter : la factory binde toujours `R2_ENDPOINT` avec le préfixe `eu.` en dur
(`live-provisioning.service.ts`), donc un projet généré ne dépend pas de la composition. Le trou ne
concernait que l'activation à la main, qui est le seul chemin où le bug mordait -- et le seul que la
documentation décrivait.

## 3. Reprise, dans l'ordre

1. **Canari DEV-473.** Toujours arrêté sur `vercel.r2-binding`, code `R2_RUNTIME_CREDENTIAL_SCOPE`.
   Recréer un token R2 Object Read & Write scopé à `void-starter-canary-documents-20260730`,
   remplacer les deux entrées du trousseau, puis `resume:live`. Procédure et identifiants de la
   pile dans le handoff du 2026-08-03, section 1. Ensuite seulement : preuve live du flux document,
   `browser_origins` complété par l'origine de Production, fermeture de DEV-473;
2. DEV-556, puis DEV-557 (bloqué par le premier);
3. findings void-music (`../2026-07-30/void-music-provisioning-findings.md`), en commençant par le
   point 0 : remonter le corps des erreurs fournisseur. Il aurait rendu immédiat le diagnostic du
   token mal scopé, qui a demandé une sonde manuelle sur deux buckets.

Reste aussi, non planifié : le test de non-régression du lint décrit au 2026-08-03 section 4, et le
`testTimeout` de la suite factory, instable sous forte charge machine.

## 4. Vérifications au moment d'écrire

Sur le merge de #22 avant push : lint 337 fichiers, type-check 13 packages, test 13 tâches, build,
knip, plus `_modules/storage-r2` hors graphe turbo racine (26 passed, 5 skipped). CI verte sur
`f7eed73` -- attention, `gh pr checks --watch` rend la main sur les checks du commit précédent, il
faut viser le run par son SHA.

`main` est propre, sans branche locale résiduelle, sans stash, sans worktree.
