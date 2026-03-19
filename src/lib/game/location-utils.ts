import type { KeyLocation } from "@/lib/game/types";

export const LEGACY_KEY_LOCATION_ROLE = "Important campaign anchor";

export function canonicalizeAnchorName(value: string) {
  return value.trim().toLowerCase();
}

export function normalizeStringList(values: unknown[]) {
  return Array.from(
    new Set(
      values
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export function normalizeKeyLocations(value: unknown): KeyLocation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: KeyLocation[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const role = typeof record.role === "string" ? record.role.trim() : "";

    if (!name || !role) {
      continue;
    }

    const key = canonicalizeAnchorName(name);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({
      name,
      role,
      isPublic: Boolean(record.isPublic),
    });
  }

  return normalized;
}

export function normalizeLegacyKeyLocations(value: unknown): KeyLocation[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: KeyLocation[] = [];

  for (const entry of value) {
    if (typeof entry !== "string" || !entry.trim()) {
      continue;
    }

    const name = entry.trim();
    const key = canonicalizeAnchorName(name);

    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push({
      name,
      role: LEGACY_KEY_LOCATION_ROLE,
      isPublic: false,
    });
  }

  return normalized;
}

export function buildKeyLocationMap(keyLocations: KeyLocation[]) {
  return new Map(keyLocations.map((location) => [canonicalizeAnchorName(location.name), location]));
}

export function findKeyLocationByName(keyLocations: KeyLocation[], value: unknown) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  return buildKeyLocationMap(keyLocations).get(canonicalizeAnchorName(value)) ?? null;
}

export function toCanonicalKeyLocationName(
  keyLocations: KeyLocation[],
  value: unknown,
): string | null {
  return findKeyLocationByName(keyLocations, value)?.name ?? null;
}
