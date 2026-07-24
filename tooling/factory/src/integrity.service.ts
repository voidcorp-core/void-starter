import { createHash } from 'node:crypto';

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .toSorted()
        .map((key) => [key, sortJsonValue(record[key])]),
    );
  }
  return value;
}

export function serializeCanonicalJson(value: unknown): string {
  return `${JSON.stringify(sortJsonValue(value), null, 2)}\n`;
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
