import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { BuildManifest } from './factory.types';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import {
  type ProvisioningAction,
  type ProvisioningContext,
  type ProvisioningPlan,
  provisioningContextSchema,
  provisioningPlanSchema,
} from './provisioning.types';

function createIdempotencyKey(action: Omit<ProvisioningAction, 'idempotency_key'>): string {
  return `void-starter:v1:${sha256(serializeCanonicalJson(action))}`;
}

function withIdempotencyKey(
  action: Omit<ProvisioningAction, 'idempotency_key'>,
): ProvisioningAction {
  return {
    ...action,
    idempotency_key: createIdempotencyKey(action),
  } as ProvisioningAction;
}

export function parseProvisioningContext(input: unknown): ProvisioningContext {
  return provisioningContextSchema.parse(input);
}

export function parseProvisioningContextSource(
  source: string,
  fileName: string,
): ProvisioningContext {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.json') {
    return parseProvisioningContext(JSON.parse(source));
  }
  if (extension === '.yaml' || extension === '.yml') {
    return parseProvisioningContext(parseYaml(source));
  }
  throw new Error(`Unsupported provisioning context format: ${extension || 'missing extension'}`);
}

export function createProvisioningPlan(
  manifest: BuildManifest,
  context: ProvisioningContext,
): ProvisioningPlan {
  const hasWeb = manifest.surfaces.web === 'next-vercel';
  const hasDatabase = manifest.data.database === 'neon-eu';

  if (hasWeb && !context.vercel) {
    throw new Error('Provisioning context requires Vercel settings for the selected web surface');
  }
  if (hasDatabase && !context.neon) {
    throw new Error('Provisioning context requires Neon settings for the selected database');
  }

  const actions: ProvisioningAction[] = [
    withIdempotencyKey({
      id: 'github.repository',
      provider: 'github',
      kind: 'ensure-repository',
      depends_on: [],
      permissions:
        context.github.owner_kind === 'organization'
          ? ['organization:members:read', 'repository:administration:write']
          : ['repository:administration:write'],
      input: {
        owner: context.github.owner,
        owner_kind: context.github.owner_kind,
        name: manifest.project.name,
        visibility: context.github.visibility,
      },
    }),
  ];

  if (hasWeb && context.vercel) {
    actions.push(
      withIdempotencyKey({
        id: 'vercel.project',
        provider: 'vercel',
        kind: 'ensure-project',
        depends_on: ['github.repository'],
        permissions: ['project:write'],
        input: {
          team_id: context.vercel.team_id,
          name: manifest.project.name,
          framework: 'nextjs',
          region: context.vercel.region,
          root_directory: 'apps/web',
          repository_action_id: 'github.repository',
        },
      }),
    );
  }

  if (hasDatabase && context.neon) {
    actions.push(
      withIdempotencyKey({
        id: 'neon.project',
        provider: 'neon',
        kind: 'ensure-project',
        depends_on: ['github.repository'],
        permissions: ['project:create'],
        input: {
          org_id: context.neon.org_id,
          name: manifest.project.name,
          region_id: context.neon.region_id,
        },
      }),
    );
  }

  if (hasWeb && hasDatabase) {
    actions.push(
      withIdempotencyKey({
        id: 'vercel.database-binding',
        provider: 'vercel',
        kind: 'ensure-database-binding',
        depends_on: ['vercel.project', 'neon.project'],
        permissions: ['project-environment:write'],
        input: {
          project_action_id: 'vercel.project',
          database_action_id: 'neon.project',
          environment_variable: 'DATABASE_URL',
          targets: ['development', 'preview', 'production'],
        },
      }),
    );
  }

  return provisioningPlanSchema.parse({
    schema_version: 1,
    manifest_sha256: sha256(serializeCanonicalJson(manifest)),
    context_sha256: sha256(serializeCanonicalJson(context)),
    cost_policy: manifest.cost_policy,
    actions,
  });
}

export function provisioningPlanDigest(plan: ProvisioningPlan): string {
  return sha256(serializeCanonicalJson(plan));
}
