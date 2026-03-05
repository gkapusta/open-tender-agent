export const UA_DEFAULT =
  process.env.LEADAGENT_USER_AGENT ?? "LeadAgentTS/0.1 (+https://example.com)";

export function normalizeText(input?: string | null, maxLen?: number): string {
  if (!input) {
    return "";
  }
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!maxLen || normalized.length <= maxLen) {
    return normalized;
  }
  return normalized.slice(0, maxLen);
}

export function firstNonEmpty<T>(...values: Array<T | null | undefined>): T | undefined {
  for (const value of values) {
    if (value) {
      return value;
    }
  }
  return undefined;
}

export function toIsoDate(d?: string | null): string | undefined {
  if (!d) {
    return undefined;
  }
  const parsed = new Date(d);
  if (Number.isNaN(parsed.getTime())) {
    return normalizeText(d);
  }
  return parsed.toISOString().slice(0, 10);
}
