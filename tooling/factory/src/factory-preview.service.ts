import { extname } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { createProjectFilePlan } from './capability-composition.service';
import { createCompositionPlan, parseBuildManifest } from './factory.service';
import type { BuildManifest, CompositionPlan, ProjectFilePlan } from './factory.types';

export type FactoryPreview = {
  composition: CompositionPlan;
  files: ProjectFilePlan;
};

export function parseManifestSource(source: string, fileName: string): BuildManifest {
  const extension = extname(fileName).toLowerCase();

  if (extension === '.json') {
    return parseBuildManifest(JSON.parse(source));
  }
  if (extension === '.yaml' || extension === '.yml') {
    return parseBuildManifest(parseYaml(source));
  }

  throw new Error(`Unsupported manifest format: ${extension || 'missing extension'}`);
}

export function createFactoryPreview(manifest: BuildManifest): FactoryPreview {
  return {
    composition: createCompositionPlan(manifest),
    files: createProjectFilePlan(manifest),
  };
}
