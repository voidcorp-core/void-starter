import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { BuildManifest } from './factory.types';
import { serializeCanonicalJson, sha256 } from './integrity.service';
import {
  manifestSha256Schema,
  type ProvisioningHandoffAction,
  type ProvisioningHandoffContext,
  type ProvisioningHandoffPlan,
  type ProvisioningPlanSha256,
  provisioningHandoffActionSchema,
  provisioningHandoffContextSchema,
  provisioningHandoffPlanSchema,
  provisioningPlanSha256Schema,
} from './provisioning-handoff.types';

export type ProvisioningHandoff = {
  plan: ProvisioningHandoffPlan;
  planSource: string;
  planSha256: ProvisioningPlanSha256;
  runbookSource: string;
};

export function parseProvisioningHandoffContext(input: unknown): ProvisioningHandoffContext {
  return provisioningHandoffContextSchema.parse(input);
}

export function parseProvisioningHandoffContextSource(
  source: string,
  fileName: string,
): ProvisioningHandoffContext {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.json') {
    return parseProvisioningHandoffContext(JSON.parse(source));
  }
  if (extension === '.yaml' || extension === '.yml') {
    return parseProvisioningHandoffContext(parseYaml(source));
  }
  throw new Error(`Unsupported provisioning handoff context format: ${extension || 'missing'}`);
}

function createGitHubAction(
  manifest: BuildManifest,
  context: ProvisioningHandoffContext,
): ProvisioningHandoffAction {
  return provisioningHandoffActionSchema.parse({
    id: 'github.repository',
    provider: 'github',
    resource_kind: 'repository',
    purpose: 'Own the canonical source repository for the generated project',
    depends_on: [],
    desired_state: {
      owner: context.github.owner,
      owner_kind: context.github.owner_kind,
      name: manifest.project.name,
      visibility: context.github.visibility,
    },
    required_credentials: [
      {
        name: 'GITHUB_TOKEN',
        purpose: 'Authorize repository creation or configuration outside the Factory',
      },
    ],
    recommended_execution: ['official-cli', 'provider-dashboard', 'external-iac'],
    expected_outputs: [
      {
        name: 'repository_url',
        purpose: 'Canonical HTTPS URL of the configured repository',
      },
    ],
    completion_criteria: [
      'The repository exists under the requested owner with the requested visibility',
    ],
    recovery: {
      inspection_required: true,
      guidance: 'Inspect the owner and repository before retrying to avoid duplicate resources.',
    },
  });
}

function createVercelAction(
  manifest: BuildManifest,
  context: ProvisioningHandoffContext,
): ProvisioningHandoffAction {
  if (!context.vercel) {
    throw new Error(
      'Provisioning handoff context requires Vercel settings for the selected web surface',
    );
  }
  return provisioningHandoffActionSchema.parse({
    id: 'vercel.project',
    provider: 'vercel',
    resource_kind: 'project',
    purpose: 'Host the selected Next.js web surface outside the Factory',
    depends_on: ['github.repository'],
    desired_state: {
      team_id: context.vercel.team_id,
      name: manifest.project.name,
      framework: 'nextjs',
      region: context.vercel.region,
      root_directory: 'apps/web',
      repository_action_id: 'github.repository',
    },
    required_credentials: [
      {
        name: 'VERCEL_TOKEN',
        purpose: 'Authorize project creation or configuration outside the Factory',
      },
    ],
    recommended_execution: ['official-cli', 'provider-dashboard', 'external-iac'],
    expected_outputs: [
      {
        name: 'project_id',
        purpose: 'Stable identifier of the configured Vercel project',
      },
      {
        name: 'project_url',
        purpose: 'Canonical dashboard URL of the configured Vercel project',
      },
    ],
    completion_criteria: [
      'The Vercel project is linked to the repository and uses the requested root',
    ],
    recovery: {
      inspection_required: true,
      guidance: 'Inspect the team project list before retrying to avoid duplicate resources.',
    },
  });
}

function createProvisioningHandoffPlan(
  manifest: BuildManifest,
  context: ProvisioningHandoffContext,
): ProvisioningHandoffPlan {
  const githubAction = createGitHubAction(manifest, context);
  const actions =
    manifest.surfaces.web === 'next-vercel'
      ? [githubAction, createVercelAction(manifest, context)]
      : [githubAction];
  return provisioningHandoffPlanSchema.parse({
    schema_version: 2,
    execution_owner: 'external',
    manifest_sha256: manifestSha256Schema.parse(sha256(serializeCanonicalJson(manifest))),
    actions,
  });
}

function desiredStateLines(action: ProvisioningHandoffAction): string[] {
  switch (action.id) {
    case 'github.repository':
      return [
        `- Owner: \`${action.desired_state.owner}\` (${action.desired_state.owner_kind})`,
        `- Repository: \`${action.desired_state.name}\``,
        `- Visibility: \`${action.desired_state.visibility}\``,
      ];
    case 'vercel.project':
      return [
        `- Team: \`${action.desired_state.team_id}\``,
        `- Project: \`${action.desired_state.name}\``,
        `- Framework: \`${action.desired_state.framework}\``,
        `- Region: \`${action.desired_state.region}\``,
        `- Root directory: \`${action.desired_state.root_directory}\``,
        `- Repository action: \`${action.desired_state.repository_action_id}\``,
      ];
    /* v8 ignore next 4 -- the discriminated union makes this branch unreachable. */
    default: {
      const exhaustiveAction: never = action;
      throw new Error(`Unsupported handoff action: ${JSON.stringify(exhaustiveAction)}`);
    }
  }
}

function renderAction(action: ProvisioningHandoffAction, index: number): string {
  const dependencies = action.depends_on.length === 0 ? 'None' : action.depends_on.join(', ');
  const credentials = action.required_credentials.map(
    (credential) => `- \`${credential.name}\`: ${credential.purpose}`,
  );
  const outputs = action.expected_outputs.map(
    (output) => `- \`${output.name}\`: ${output.purpose}`,
  );
  const criteria = action.completion_criteria.map((criterion) => `- ${criterion}`);
  return [
    `## ${index + 1}. \`${action.id}\``,
    '',
    `Provider: \`${action.provider}\``,
    `Resource: \`${action.resource_kind}\``,
    `Dependencies: ${dependencies}`,
    `External execution: ${action.recommended_execution.join(', ')}`,
    '',
    '### Why',
    '',
    action.purpose,
    '',
    '### Desired state',
    '',
    ...desiredStateLines(action),
    '',
    '### Required credential names',
    '',
    ...credentials,
    '',
    '### Expected non-secret outputs',
    '',
    ...outputs,
    '',
    '### Completion criteria',
    '',
    ...criteria,
    '',
    '### Recovery',
    '',
    action.recovery.guidance,
  ].join('\n');
}

export function renderProvisioningHandoffRunbook(plan: ProvisioningHandoffPlan): string {
  const sections = plan.actions.map(renderAction).join('\n\n');
  return `# Provisioning handoff

The Factory prepared this local intent. An external operator, official provider tool,
generated-project pipeline, or independently maintained infrastructure as code owns execution.
The Factory does not verify remote state.

- Schema version: \`${plan.schema_version}\`
- Execution owner: \`${plan.execution_owner}\`
- Manifest SHA-256: \`${plan.manifest_sha256}\`

${sections}
`;
}

export function parseProvisioningHandoffPlan(input: unknown): ProvisioningHandoffPlan {
  return provisioningHandoffPlanSchema.parse(input);
}

export function validateProvisioningHandoffPlan(
  manifest: BuildManifest,
  plan: ProvisioningHandoffPlan,
): void {
  const expectedIds =
    manifest.surfaces.web === 'next-vercel'
      ? ['github.repository', 'vercel.project']
      : ['github.repository'];
  if (plan.manifest_sha256 !== sha256(serializeCanonicalJson(manifest))) {
    throw new Error('Provisioning handoff manifest digest does not match the normalized manifest');
  }
  if (plan.actions.map((action) => action.id).join('\n') !== expectedIds.join('\n')) {
    throw new Error('Provisioning handoff actions do not match the selected minimal surfaces');
  }
  if (plan.actions.some((action) => action.desired_state.name !== manifest.project.name)) {
    throw new Error('Provisioning handoff project names do not match the normalized manifest');
  }
}

export function createProvisioningHandoff(
  manifest: BuildManifest,
  context: ProvisioningHandoffContext,
): ProvisioningHandoff {
  const plan = createProvisioningHandoffPlan(manifest, context);
  const planSource = serializeCanonicalJson(plan);
  return {
    plan,
    planSource,
    planSha256: provisioningPlanSha256Schema.parse(sha256(planSource)),
    runbookSource: renderProvisioningHandoffRunbook(plan),
  };
}
