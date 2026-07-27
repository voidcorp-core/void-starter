# Void Starter - paquet de découverte

> Promu le 2026-07-24 dans `/Users/folpe/Developer/void-starter/docs/FACTORY.md`
> et `docs/DECISIONS.md` ADR 37. Ce snapshot est désormais historique.

## Ambition décidée

Void Starter ne doit plus être un dépôt que l'on clone puis câble manuellement. Il devient une
factory composable de projets opérationnels.

Forge produit le manifeste du projet ; Void Starter planifie et applique la composition ; Void
Harness vérifie et accompagne le développement.

```text
Forge -> build manifest -> Void Starter -> projet déployé -> Void Harness
```

L'objectif est de pouvoir commencer directement le code produit avec :

- repository GitHub ;
- application web et/ou mobile ;
- base ;
- authentification ;
- migrations et seed ;
- variables et secrets ;
- stockage et email si nécessaires ;
- observabilité ;
- déploiements ;
- smoke tests ;
- projet Linear.

## État actuel observé pendant la découverte

Stack existante :

- Bun + Turborepo ;
- Next.js + React + TypeScript ;
- Tailwind ;
- Drizzle + Neon ;
- Better Auth ;
- Vercel ;
- modules Sentry/PostHog ;
- packages et modules optionnels partiellement préparés.

Écarts signalés :

- onboarding encore largement manuel ;
- création Neon et liaison Vercel manuelles ;
- variables à tirer et compléter ;
- secret auth à générer ;
- migrations et promotion admin manuelles ;
- email de vérification Better Auth non réellement câblé ;
- magic link non opérationnel en production ;
- modules placeholder encore présents ;
- pas de `plan/apply/resume/doctor` ;
- pas de fixture testant chaque profil généré.

Ces constats devront être revérifiés dans le repo avant implémentation.

## Composition de surfaces décidée

Le même produit Void Starter peut proposer plusieurs surfaces, sans les générer toutes :

```yaml
surfaces:
  web: optional
  mobile: optional
  worker: optional
```

- Web : Next.js sur Vercel.
- Mobile : Expo/EAS/React Native, ajouté seulement si Forge le justifie.
- Packages partagés : domaine, auth client, contrats API, validation et design tokens.
- tRPC n'est pas obligatoire ni le défaut universel.
- Server Actions pour les usages internes web.
- REST/OpenAPI lorsque mobile ou API publique.
- WebRTC/WebSocket/SSE selon la sémantique temps réel.

## Doctrine de stack décidée

| Charge | Défaut |
|---|---|
| Web Next.js | Vercel |
| API HTTP/BFF | Vercel Functions |
| Jobs durables | Vercel Workflows |
| Cron critique | Cron vers Workflow idempotent |
| Voix continue | WebRTC direct fournisseur |
| État temps réel partagé | Cloudflare Durable Objects EU si nécessaire |
| Service toujours actif | Render ou Fly seulement sur justification |
| PostgreSQL | Neon + Drizzle |
| Auth | Better Auth industrialisé |
| Documents privés pérennes | Cloudflare R2 EU |
| Assets simples | Vercel Blob possible |
| Email | Resend |
| Erreurs | Sentry |
| Analytics produit | PostHog |
| Mobile | Expo + EAS |

Next.js, Drizzle et Better Auth sont conservés. Neon Auth et TanStack Start restent à surveiller
mais ne sont pas les défauts actuels. Clerk est un profil d'exception pour un besoin B2B/SSO ou
un délai extrême.

## Doctrine infrastructure décidée

- Vercel reste le centre de gravité, pas l'hébergeur universel.
- Cloudflare est un second fournisseur autorisé.
- Un troisième compute provider n'est ajouté qu'en présence d'un workload incompatible.
- EU-primary pour les données personnelles.
- Vercel Functions et Neon colocalisés en Europe.
- Gandi reste registrar.
- Cloudflare DNS devient le défaut recommandé des nouveaux projets.
- Gandi LiveDNS et Vercel DNS restent supportés par adaptateurs.
- Aucun changement de nameserver sans plan et approbation.
- Pas de secret dans le manifeste.
- Vercel/EAS gèrent les secrets opérationnels ; chiffrement applicatif des tokens sensibles.
- Aucun upgrade payant automatique.
- Budget additionnel cible proche de 10 EUR/mois lorsqu'un gain net le justifie.

## Manifeste cible

```yaml
project:
  name: example
  profile: saas

surfaces:
  web: next-vercel
  mobile: none

workloads:
  http: vercel-functions
  durable_jobs: vercel-workflows
  realtime_audio: none
  persistent_service: none

data:
  database: neon-eu
  orm: drizzle
  auth: better-auth
  files: cloudflare-r2-eu

operations:
  errors: sentry
  analytics: posthog
  email: resend

cost_policy:
  automatic_monthly_limit_eur: 10
  paid_upgrade_requires_approval: true
```

## Cycle de création cible

```text
void plan
  -> affiche ressources, coûts, permissions et changements DNS

void apply
  -> GitHub
  -> fournisseurs sélectionnés
  -> variables et secrets
  -> migrations + seed
  -> domaines
  -> déploiements
  -> smoke tests

void resume
  -> reprend après interruption sans dupliquer les ressources

void doctor
  -> vérifie code, infrastructure, auth, DB, DNS et déploiement

receipt
  -> IDs opaques, versions, URLs, coûts, preuves et prochaines actions
```

## Auth par profils

- Défaut général : `public_verified`.
- Cortex : `public_signup_gated_activation`.
- Outils internes : `invite_only`.
- Email verification réellement implémentée.
- Passkeys/MFA activables par manifeste.
- Seed admin sans édition SQL manuelle.

## Questions ouvertes

- Nom et interface définitive du CLI/composer.
- Stratégie exacte de secrets entre local, Vercel, EAS et CI.
- Niveau de rollback automatisable sur les ressources externes.
- Adaptateur Linear : Forge crée le projet et le backlog ; Harness actualise l'exécution.
- Matrice de tests minimale par combinaison de capacités.
- Politique d'upgrade des versions Expo/Next et compatibilité React dans le monorepo.
