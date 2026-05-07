export function maskEmail(input: string): string {
  const at = input.indexOf('@');
  if (at <= 0) return input;
  const local = input.slice(0, at);
  const domain = input.slice(at);
  if (local.length === 1) return `*${domain}`;
  if (local.length === 2) return `${local.charAt(0)}*${domain}`;
  return `${local.charAt(0)}${'*'.repeat(local.length - 2)}${local.charAt(local.length - 1)}${domain}`;
}

export function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max)}...`;
}
