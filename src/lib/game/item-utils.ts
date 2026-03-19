export const MAX_STARTER_ITEMS = 4;
export const MAX_LOOT_DISCOVERIES = 2;

export function normalizeItemName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

export function normalizeItemNameList(
  names: readonly string[] | null | undefined,
  options?: { maxItems?: number },
) {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const name of names ?? []) {
    const cleaned = normalizeItemName(name);

    if (!cleaned) {
      continue;
    }

    const key = cleaned.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(cleaned);

    if (options?.maxItems && normalized.length >= options.maxItems) {
      break;
    }
  }

  return normalized;
}
