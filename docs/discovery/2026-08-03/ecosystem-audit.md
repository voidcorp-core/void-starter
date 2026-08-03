# Audit de l'écosystème : Forge, Void Starter, Void Harness

> Relevé le 2026-08-03. Aucun secret n'est enregistré dans ce document. Toutes les mesures ont été
> obtenues en exécutant sur les trois dépôts, pas en lisant leurs intentions.

## Correction préalable

J'ai affirmé la veille qu'« il n'existe nulle part de contrat écrit sur ce que les trois outils
écrivent dans le dépôt d'un consommateur ». C'est faux : `docs/ECOSYSTEM-CONTRACTS.md` existe chez
Forge, daté du 2026-07-24, avec les trois projets comme propriétaires déclarés, une carte
d'ownership par frontière et dix règles non négociables. Ce document est bon. L'audit qui suit ne
dit pas qu'il manque, il mesure l'écart entre ce qu'il déclare et ce qui est vérifié.

## Carte des trois

| | Forge | Void Starter | Void Harness |
|---|---|---|---|
| commits | 90 | 291 | 669 |
| code | 0 `.ts`, 9 `.js`/`.mjs` | 254 `.ts` | 665 `.ts` |
| documentation | 105 `.md` | 45 `.md` | 684 `.md` |
| runtime | Node >= 22.12 | Bun 1.3.14, Node >= 24 | pnpm 10.34, Node >= 22.12 |
| licence | MIT, public | privé | MIT, privé |
| qualité | CI seule | biome, lefthook, commitlint, knip, CI | biome, CI |
| formateur | aucun | actif, 100 colonnes | **désactivé** |
| commits conventionnels | 31/40 | 33/40 | 34/40 |

Trois natures différentes, et c'est le premier fait de l'audit : Forge est un moteur de méthode
(markdown, schémas, skills, zéro TypeScript), le Starter est une factory qui produit et provisionne,
le Harness est un CLI de discipline d'exécution. Leurs volumétries disent la même chose que leurs
rôles.

## Ce que chacun écrit chez le consommateur

C'est le point qui a motivé cet audit, et la fragmentation est plus large qu'attendu.

| Racine | Écrite par | Contenu |
|---|---|---|
| `.void/` | Harness | `config.json`, `hooks/`, `receipts/install-v1.json`, `PROJECT-DOCTRINE.md` |
| `.claude/` | Harness | `skills/`, `agents/`, `commands/` |
| `.codex/` | Harness | `hooks.json` compilé |
| `.agents/` | Harness | contexte, dont la cible du project pack Forge |
| `.void-forge/` | Forge | `artifacts/`, `install-receipt.json` |
| `.forge/` | Forge | artefacts de run (variante) |
| `.void-starter/` | **Starter et Forge** | reçus de génération/provisioning/livraison, **et** `project-pack-receipt.json` |

Sept racines pour trois outils, et surtout : **deux outils écrivent dans le dossier nommé d'après le
troisième**. `.void-starter/` n'est plus le dossier du starter depuis l'intégration du Project Pack.

La carte d'ownership de `ECOSYSTEM-CONTRACTS.md` couvre les contrats de données (qui produit quel
schéma, qui le valide). Elle ne dit rien des chemins. C'est précisément le trou par lequel la
convention a dérivé, sans qu'aucune règle ne soit violée.

## Le contrat déclaré contre le contrat vérifié

`ECOSYSTEM-CONTRACTS.md` pose six frontières. Deux se déclarent elles-mêmes incomplètes :

- Factory → repo : « à formaliser côté Void Starter »;
- Repo → runtime : « deployment receipt à construire » — partiellement comblé depuis par
  `delivery-state.json`, sans que le document l'enregistre.

Trois observations sur les quatre autres.

**Le handshake Forge → Starter n'est rejouable nulle part.** `void-forge consumer-check
--consumer-root ~/Developer/void-starter` échoue immédiatement : `dossier introuvable :
.void-forge/artifacts`. Ni `.void-forge/` ni `.forge/` n'existent dans le dépôt Forge, donc aucun
run n'y a été produit. La commande est écrite, documentée, et n'a aucune exécution vivante.

**Aucune CI ne l'exerce.** Les workflows de Forge ne mentionnent ni `consumer-check` ni
`void-starter`. La règle 2 du contrat — « le producteur n'auto-certifie pas sa sortie, le CLI de
Void Starter valide réellement » — repose donc entièrement sur une exécution manuelle que personne
n'est tenu de faire.

**Le contrat `forge/project-pack-v1` est testé contre une fixture fabriquée.**
`docs/FACTORY.md` affirme : « Contract drift is tested against real Forge output before a revision
is accepted. » Dans les faits, `project-pack.service.test.ts` construit son arborescence
`forge-output/.forge` dans le test lui-même. C'est un test de conformité du consommateur à sa propre
idée du schéma, pas à la sortie du producteur. La phrase décrit une intention de procédure humaine;
elle se lit comme une garantie automatisée.

## Duplications

Les trois ont implémenté le même motif, chacun de son côté :

| | Forge | Starter | Harness |
|---|---|---|---|
| aperçu non mutant | `preview`, `project-pack-check` | `plan`, `*:preflight` | `check` |
| application | `foundation apply` | `apply:live`, `*:live` | `install` |
| reprise | — | `resume`, `*:resume` | `adoption` |
| diagnostic | `forge-doctor` | `doctor.cli.ts` | `doctor.ts` |
| reçu | `install-receipt.json`, `project-pack-receipt.json` | 8 fichiers d'état | `receipts/install-v1.json` |

Trois `doctor`, trois notions de reçu, trois formats, trois conventions de nommage. Le motif est le
bon — dry-run, application confirmée, reçu, reprise idempotente — et il a été redécouvert trois
fois. C'est le vrai coût de la séparation, bien plus que la coordination.

Un détail révélateur : le Harness écrit son reçu dans `.void/receipts/install-v1.json`, avec la
version dans le nom de fichier. Le Starter met le `schema_version` dans le contenu. Forge fait les
deux selon le fichier. Aucune de ces trois conventions n'est mauvaise; leur coexistence l'est.

## Divergences de convention, et leur cause mécanique

Le Harness a `formatter.enabled: false` et n'applique Biome qu'à une allowlist de chemins sources.
Le Starter a un formateur actif à 100 colonnes sur tout le dépôt.

C'est l'explication mécanique du défaut trouvé le 2026-07-31 : `excludeHarnessFromLint` réécrit le
`biome.json` du consommateur avec `JSON.stringify(config, null, 2)`, ce qui produit des tableaux
multi-lignes. Chez le Harness, aucun formateur ne s'en plaint. Chez le Starter, `bun run lint`
devient rouge sur le fichier que le Harness vient d'écrire. **Un outil qui édite la configuration
d'autrui hérite des contraintes d'autrui, et le Harness n'a pas les siennes pour le lui rappeler.**

Autres écarts, sans gravité mais sans raison :

- trois gestionnaires de paquets (npm implicite, Bun, pnpm) et trois planchers Node (22.12, 24,
  22.12) pour trois outils qu'un même développeur fait tourner sur la même machine;
- seul le Starter a `lefthook`, `commitlint` et `knip`. Les trois respectent pourtant les commits
  conventionnels à ~80 %, donc la discipline existe sans être outillée ailleurs;
- le Harness est le seul à ne pas pouvoir vérifier sur lui-même la règle de format qu'il impose
  aux autres.

## Risques, classés

**1. Le contrat inter-projets n'a aucun test automatisé.** Rien n'empêche une révision de
`forge/project-pack-v1` de partir sans que le Starter le sache. La détection dépend d'un humain qui
se souvient de lancer `consumer-check`, contre un run qui n'existe pas. C'est le risque le plus
sérieux parce qu'il touche la seule frontière de données réelle entre les trois.

**2. `doctor` est inutilisable sur un projet vivant.** Sur `void-music` il déclare interdits le
`CLAUDE.md` du consommateur, son `.mcp.json`, son `.git` et l'état du Harness qu'on lui recommande
d'installer. Déjà consigné en DEV-556.

**3. La fragmentation des chemins n'est bornée par aucune règle.** Sept racines aujourd'hui, aucune
autorité pour dire qui a le droit d'en créer une huitième, ni pour dire qu'un outil ne devrait pas
écrire dans le dossier d'un autre. Déjà consigné en DEV-557.

**4. Un outil édite la configuration d'un autre sans en connaître les contraintes.** Corrigé pour ce
cas précis, non corrigé comme classe. Le Harness écrit dans `.claude`, `.codex`, `.void` et
maintenant `biome.json`; rien ne dit ce qu'il a le droit de toucher.

## Recommandations

**Ne pas fusionner.** L'audit renforce la séparation plutôt qu'il ne l'entame : trois runtimes,
trois licences, trois publics, et surtout une règle — « le Harness n'entre jamais dans le projet
généré » — qui est aujourd'hui garantie par la topologie et deviendrait une discipline en monorepo.

Ce que l'audit recommande, dans l'ordre :

1. **Étendre `ECOSYSTEM-CONTRACTS.md` d'une carte des chemins**, au même titre que sa carte des
   contrats de données : qui possède quelle racine, qui a le droit d'écrire chez qui, ce qui est
   exclu de la livraison. C'est le document qui existe déjà et qui a la bonne autorité; il lui
   manque une section, pas un remplaçant. DEV-557 en est la première application.
2. **Rendre le handshake Forge → Starter exécutable en CI.** Un run Forge gelé, versionné, rejoué
   par la CI du Starter contre `void/project-v1` et `forge/project-pack-v1`. Tant que ça n'existe
   pas, `docs/FACTORY.md` doit cesser d'affirmer que la dérive est testée contre la sortie réelle :
   c'est aujourd'hui une procédure humaine.
3. **DEV-556**, qui rend `doctor` utilisable sur un projet en production.
4. **Décider de la troisième implémentation avant de l'écrire.** Le motif preview/apply/receipt/
   resume a été redécouvert trois fois. La prochaine frontière qui en aura besoin est le bon moment
   pour extraire, pas la quatrième.

## Angle mort de cet audit

Je n'ai pas lu le code de Forge en profondeur — 105 fichiers markdown et une poignée de scripts,
dont je n'ai inspecté que les points de contact. S'il existe un run Forge complet ailleurs que sur
cette machine, la conclusion « le handshake n'est rejouable nulle part » est trop forte et devrait
se lire « n'est pas rejouable ici ».

Je n'ai pas non plus mesuré le coût réel de la coordination à trois dépôts pour une personne seule,
qui est le seul argument sérieux en faveur de la fusion et le seul que je ne peux pas observer.
