import { isAbsolute, posix } from 'node:path';
import { z } from 'zod';

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const documentIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const gapIdSchema = z.string().regex(/^GAP-[0-9]{3,}$/);
const stageStatusSchema = z.enum([
  'missing',
  'draft',
  'reviewed',
  'conditional',
  'accepted',
  'stale',
  'blocked',
]);

export function isSafeRelativePath(value: string): boolean {
  if (!value || isAbsolute(value) || value.includes('\\') || value.includes('\0')) {
    return false;
  }
  if (value !== posix.normalize(value)) {
    return false;
  }
  return value.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

const safeRelativePathSchema = z.string().superRefine((value, context) => {
  if (!isSafeRelativePath(value)) {
    context.addIssue({
      code: 'custom',
      message: 'Expected a safe relative path without traversal or backslashes',
    });
  }
});

const uniqueStringArray = <T extends z.ZodType<string>>(itemSchema: T) =>
  z.array(itemSchema).superRefine((values, context) => {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: 'custom', message: 'Expected unique values' });
    }
  });

const projectPackDocumentSchema = z.strictObject({
  id: documentIdSchema,
  pack_path: safeRelativePathSchema,
  target_path: safeRelativePathSchema,
  status: z.enum(['ready', 'conditional']),
  media_type: z.literal('text/markdown'),
  merge_policy: z.literal('create_or_replace_if_receipt_matches'),
  source_paths: uniqueStringArray(safeRelativePathSchema).min(1),
  source_hash: sha256Schema,
  content_hash: sha256Schema,
});

const stageStatusesSchema = z
  .object({
    product: stageStatusSchema,
    trust: stageStatusSchema,
    experience: stageStatusSchema,
    build: stageStatusSchema,
  })
  .catchall(stageStatusSchema);

export const projectPackManifestSchema = z
  .strictObject({
    schema_version: z.literal('forge/project-pack-v1'),
    project_id: z.string().trim().min(1),
    status: z.enum(['ready', 'conditional']),
    generated_at: z.string().min(1),
    source_hash: sha256Schema,
    stage_statuses: stageStatusesSchema,
    open_gap_ids: uniqueStringArray(gapIdSchema),
    merge_contract: z.strictObject({
      initial_write: z.literal('create_only'),
      update_write: z.literal('replace_if_destination_hash_matches_receipt'),
      conflict: z.literal('fail_without_overwrite'),
      receipt_required: z.literal(true),
      agent_context_target: z.literal('.agents/context/forge-project.md'),
    }),
    documents: z.array(projectPackDocumentSchema).length(14),
  })
  .superRefine((manifest, context) => {
    const identities = manifest.documents.map((document) => document.id);
    const packPaths = manifest.documents.map((document) => document.pack_path);
    const targetPaths = manifest.documents.map((document) => document.target_path);

    for (const [field, values] of [
      ['id', identities],
      ['pack_path', packPaths],
      ['target_path', targetPaths],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          message: `Project Pack document ${field} values must be unique`,
          path: ['documents'],
        });
      }
    }

    if (!packPaths.every((packPath) => packPath.startsWith('project-pack/'))) {
      context.addIssue({
        code: 'custom',
        message: 'Project Pack source paths must live under project-pack/',
        path: ['documents'],
      });
    }

    if (!targetPaths.includes(manifest.merge_contract.agent_context_target)) {
      context.addIssue({
        code: 'custom',
        message: 'Project Pack must declare the agent context target',
        path: ['documents'],
      });
    }
  });

export type ProjectPackManifest = z.infer<typeof projectPackManifestSchema>;
export type ProjectPackDocument = ProjectPackManifest['documents'][number];

const receiptFileSchema = z.strictObject({
  document_id: documentIdSchema,
  target_path: safeRelativePathSchema,
  action: z.enum(['created', 'updated', 'unchanged']),
  before_sha256: sha256Schema.nullable(),
  after_sha256: sha256Schema,
});

export const projectPackReceiptSchema = z
  .strictObject({
    schema_version: z.literal(1),
    contract: z.literal('forge/project-pack-v1'),
    consumer: z.strictObject({
      name: z.literal('void-starter'),
      version: z.string().min(1),
    }),
    project_id: z.string().trim().min(1),
    pack_source_hash: sha256Schema,
    pack_generated_at: z.string().min(1),
    pack_status: z.enum(['ready', 'conditional']),
    stage_statuses: stageStatusesSchema,
    open_gap_ids: uniqueStringArray(gapIdSchema),
    files: z.array(receiptFileSchema).length(14),
  })
  .superRefine((receipt, context) => {
    for (const [field, values] of [
      ['document_id', receipt.files.map((file) => file.document_id)],
      ['target_path', receipt.files.map((file) => file.target_path)],
    ] as const) {
      if (new Set(values).size !== values.length) {
        context.addIssue({
          code: 'custom',
          message: `Project Pack receipt ${field} values must be unique`,
          path: ['files'],
        });
      }
    }
  });

export type ProjectPackReceipt = z.infer<typeof projectPackReceiptSchema>;

export type ProjectPackActionKind = 'create' | 'update' | 'unchanged' | 'conflict';

export type ProjectPackActionReason =
  | 'destination_missing'
  | 'destination_exists_without_receipt'
  | 'managed_destination_missing'
  | 'managed_destination_modified'
  | 'managed_destination_matches_pack'
  | 'managed_destination_outdated';

export type ProjectPackAction = {
  document_id: string;
  source_path: string;
  target_path: string;
  action: ProjectPackActionKind;
  reason: ProjectPackActionReason;
  expected_before_sha256: string | null;
  desired_sha256: string;
};

export type ProjectPackPlan = {
  schema_version: 1;
  contract: 'forge/project-pack-v1';
  project_id: string;
  pack_source_hash: string;
  pack_status: 'ready' | 'conditional';
  open_gap_ids: string[];
  receipt_path: '.void-starter/project-pack-receipt.json';
  receipt_action: 'create' | 'update' | 'unchanged';
  status: 'applicable' | 'current' | 'conflict';
  summary: Record<ProjectPackActionKind, number>;
  actions: ProjectPackAction[];
};

export type ProjectPackInput = {
  manifestPath: string;
  targetRoot: string;
};

export type ApplyProjectPackInput = ProjectPackInput & {
  confirmedProjectId: string;
};

export type ProjectPackApplyResult = {
  mutated: boolean;
  plan: ProjectPackPlan;
  receipt: ProjectPackReceipt;
};
