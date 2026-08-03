# Provisioning void-music : correctifs à porter dans void-starter

> Relevé le 2026-07-30 pendant le provisioning réel du projet `void-music`
> (`voidcorp-core/void-music`). Aucun secret n'est enregistré dans ce document.
>
> Contexte : provisioning complet réussi (9 actions sur 9), mais au prix de huit
> allers-retours de diagnostic manuel. Chacun est un correctif identifié ci-dessous.

## 0. Correctif à plus fort levier : remonter le corps des erreurs provider

**Constat.** Les échecs sont remontés sous la forme `<provider>_HTTP_<status>` sans le corps de
la réponse. Or chaque provider nomme la cause exacte dans ce corps :

| Remonté par la factory | Corps réel de la réponse |
|---|---|
| `CLOUDFLARE_HTTP_403` | `code 10042: Please enable R2 through the Cloudflare Dashboard.` |
| `SENTRY_HTTP_403` | `Your organization has disabled this feature for members.` |
| `VERCEL_HTTP_400` | l'intégration GitHub ne voit pas le namespace cible |

**Impact.** Chacun de ces trois échecs a demandé une reproduction manuelle en `curl` pour
obtenir une information que le provider avait déjà fournie. C'est la source principale du coût
de diagnostic.

**Correctif.** Dans `#request` / `ProviderHttpFailure`, lire le corps en cas de statut non
accepté et l'inclure tronqué (240 caractères suffisent) dans le message d'erreur. Les corps de
ces trois providers ne contiennent pas de secret. À défaut, l'inclure derrière un `--verbose`.

## 1. Sentry : scopes du token non documentés

**Constat.** `#preflightSentry` appelle `GET /teams/{org}/{team}/` (endpoint legacy), qui exige
`team:read`. `docs/FACTORY.md` ne liste aucun scope requis pour `SENTRY_API_TOKEN`. Un token
avec `org:read` + `project:write` passe la moitié des appels puis échoue en 403.

**Correctif.** Documenter les quatre scopes nécessaires : `org:read`, `team:read`,
`project:read`, `project:write`. Préciser qu'il s'agit d'un *User* Auth Token, pas d'un
*Organization* Auth Token (dont les scopes figés ne couvrent pas ces lectures).

## 2. Sentry : `allowMemberProjectCreation` non vérifié au preflight

**Constat.** Le preflight valide l'organisation et la team, puis l'apply échoue à la création
avec 403 « disabled this feature for members ». L'organisation exposait pourtant
`allowMemberProjectCreation: false` dans une réponse déjà lue par le preflight.

**Correctif.** Ajouter la vérification de `allowMemberProjectCreation` dans `#preflightSentry`
et échouer tôt avec un message actionnable. Un preflight qui passe puis un apply qui échoue sur
un attribut lisible au preflight est un faux négatif.

## 3. Cloudflare : R2 non activé sur le compte

**Constat.** Un token correctement scopé `Workers R2 Storage: Edit` renvoie 403 tant que R2
n'a jamais été activé dans le dashboard. Le preflight ne distingue pas « token insuffisant » de
« produit non activé ».

**Correctif.** Détecter le code d'erreur Cloudflare `10042` et le remonter comme une cause
distincte, par exemple `CLOUDFLARE_R2_NOT_ENABLED`, avec l'action à mener.

## 4. Vercel : accès de l'intégration Git au namespace non vérifié

**Constat.** `#ensureVercelProject` poste `gitRepository: { type: 'github', repo: <owner/name> }`.
Si l'application GitHub de Vercel n'est pas installée sur l'organisation cible, Vercel répond
400 sans indication exploitable. Ici la team voyait `declik-ai` mais pas `voidcorp-core`.

**Correctif.** Ajouter au preflight Vercel un appel à
`GET /v1/integrations/git-namespaces?provider=github&teamId=…` (ou `/v9/integrations/search-repo`)
et vérifier que l'owner GitHub de la fixture y figure. C'est une lecture authentifiée, donc
compatible avec la garantie « preflight ne mute rien ».

## 5. Aucune issue documentée quand la fixture change après un apply partiel

**Constat.** Corriger une valeur de la fixture (ici le slug d'organisation Sentry) après un
apply partiel rend l'état inutilisable : `Existing provisioning state belongs to a different or
modified plan`. Les CLI n'exposent que `--help` et `--confirm-project`.

**Contournement utilisé.** Renommer `.void-starter/apply-state.json` puis relancer `apply:live`.
Le lookup-before-create a correctement adopté les six ressources déjà créées, sans doublon.
Le mécanisme d'adoption fonctionne donc, seule la procédure n'est pas documentée.

**Correctif.** Soit un flag `--replan` qui archive l'état et repart du lookup, soit une section
de `docs/FACTORY.md` décrivant explicitement ce contournement.

## 6. `source:live` : repo créé sans commit initial

**Constat.** `source:live` a échoué en `GITHUB_SOURCE_PUSH_UNCONFIRMED` et le dépôt distant est
resté strictement vide (0 commit, `size: 0`). Dans cet état, toute opération de l'API Git Data
renvoie 409 `Git Repository is empty` : `/git/refs`, `/git/commits` et même `/git/blobs`.

**Nuance importante.** Le handoff canary du 2026-07-25 rapporte un `source:live` suivi d'un
`source:resume` qui a réconcilié avec succès. Le chemin nominal fonctionne donc au moins parfois.
Ce qui n'a pas été testé ici : `source:resume` après cet échec précis. La publication a été
faite en git standard, ce qui a rendu le test impossible a posteriori.

**Correctif suggéré.** Créer le dépôt avec `auto_init: true`, ou amorcer un premier commit via
`PUT /repos/{owner}/{repo}/contents/{path}` (qui fonctionne sur dépôt vide) avant toute
utilisation de l'API Git Data. À reproduire sur un dépôt neuf pour confirmer.

## 7. Le token de provisioning ne peut pas pousser `.github/workflows/**`

**Constat.** Le token fine-grained disposait de `admin: true`, `push: true` et
`Contents: Read and write`. Le push a été rejeté par GitHub :

```
refusing to allow a Personal Access Token to create or update workflow
`.github/workflows/ci.yml` without `workflow` scope
```

Or tout projet généré par la factory contient `.github/workflows/`. La permission est donc
systématiquement requise, pas optionnelle.

**Correctif.** Ajouter `Repository permissions > Workflows: Read and write` à la liste
documentée des permissions du `GITHUB_TOKEN`, et le vérifier dans `source:preflight`.

## 8. Détail mineur : `packages/notes` dans la sortie générée

Le module de démonstration `@repo/notes` est présent dans tout projet généré et référencé depuis
six fichiers (`apps/web/package.json`, `next.config.ts`, la page, l'action serveur, le schéma
Drizzle, `proxy.test.ts`). Son retrait est un petit refactor manuel à chaque nouveau projet.

**Piste.** L'exposer comme un module opt-in de `_modules/`, ou l'exclure via une clé de manifeste
du type `examples: include | exclude`.

---

## Ordre de traitement suggéré

1. Point 0 (corps des erreurs) : plus fort levier, corrige le symptôme de 2, 3 et 4.
2. Points 1, 2, 4, 7 : préflights et documentation, faible coût, forte valeur.
3. Point 6 : à reproduire d'abord sur un dépôt neuf.
4. Points 5 et 8 : confort.
