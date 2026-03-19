import type {
  CampaignBlueprint,
  CampaignState,
  GeneratedCampaignSetup,
  KeyLocation,
} from "@/lib/game/types";
import {
  buildKeyLocationMap,
  canonicalizeAnchorName,
  normalizeKeyLocations,
  normalizeLegacyKeyLocations,
  normalizeStringList,
} from "@/lib/game/location-utils";

export function parseBlueprint(value: unknown) {
  return value as CampaignBlueprint;
}

export function parseCampaignState(value: unknown) {
  const state = value as CampaignState;
  const rawState = state as Record<string, unknown>;
  const rawSceneState =
    state.sceneState && typeof state.sceneState === "object" && !Array.isArray(state.sceneState)
      ? (state.sceneState as Record<string, unknown>)
      : {};
  const discoveredSceneLocations = Array.isArray(rawState.discoveredSceneLocations)
    ? rawState.discoveredSceneLocations
    : [];
  const discoveredKeyLocationNames = Array.isArray(rawState.discoveredKeyLocationNames)
    ? rawState.discoveredKeyLocationNames
    : [];

  return {
    ...state,
    sceneState: {
      ...state.sceneState,
      keyLocationName:
        typeof rawSceneState.keyLocationName === "string" && rawSceneState.keyLocationName.trim()
          ? String(rawSceneState.keyLocationName).trim()
          : null,
    },
    discoveredSceneLocations: normalizeStringList(discoveredSceneLocations),
    discoveredKeyLocationNames: normalizeStringList(discoveredKeyLocationNames),
  } as CampaignState;
}

function normalizeKnownKeyLocationNames(entries: unknown[], keyLocations: KeyLocation[]) {
  const keyLocationMap = buildKeyLocationMap(keyLocations);
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const entry of entries) {
    if (typeof entry !== "string" || !entry.trim()) {
      continue;
    }

    const location = keyLocationMap.get(canonicalizeAnchorName(entry));
    if (!location) {
      continue;
    }

    const canonical = canonicalizeAnchorName(location.name);
    if (seen.has(canonical)) {
      continue;
    }

    seen.add(canonical);
    normalized.push(location.name);
  }

  return normalized;
}

export function hydrateCampaignState(value: unknown, keyLocations: KeyLocation[]) {
  const rawState = value as CampaignState & {
    knownLocations?: unknown;
  };
  const state = parseCampaignState(value);
  const keyLocationMap = buildKeyLocationMap(keyLocations);
  const legacyKnownLocations = Array.isArray(rawState?.knownLocations) ? rawState.knownLocations : [];
  const publicKeyLocationNames = keyLocations.filter((location) => location.isPublic).map((location) => location.name);
  const legacyDiscoveredKeyLocationNames = normalizeKnownKeyLocationNames(legacyKnownLocations, keyLocations);
  const legacyDiscoveredSceneLocations = normalizeStringList(
    legacyKnownLocations.filter((entry) => {
      if (typeof entry !== "string" || !entry.trim()) {
        return false;
      }

      return !keyLocationMap.has(canonicalizeAnchorName(entry));
    }),
  );
  const recoveredSceneKeyLocationName =
    state.sceneState.keyLocationName && keyLocationMap.has(canonicalizeAnchorName(state.sceneState.keyLocationName))
      ? keyLocationMap.get(canonicalizeAnchorName(state.sceneState.keyLocationName))?.name ?? null
      : keyLocationMap.get(canonicalizeAnchorName(state.sceneState.location))?.name ?? null;

  return {
    ...state,
    sceneState: {
      ...state.sceneState,
      keyLocationName: recoveredSceneKeyLocationName,
    },
    discoveredSceneLocations: normalizeStringList([
      ...legacyDiscoveredSceneLocations,
      ...state.discoveredSceneLocations,
      state.sceneState.location,
    ]),
    discoveredKeyLocationNames: normalizeKnownKeyLocationNames(
      [
        ...publicKeyLocationNames,
        ...legacyDiscoveredKeyLocationNames,
        ...state.discoveredKeyLocationNames,
        ...(recoveredSceneKeyLocationName ? [recoveredSceneKeyLocationName] : []),
      ],
      keyLocations,
    ),
  } as CampaignState;
}

export function parseGeneratedCampaignSetup(
  publicSynopsis: unknown,
  secretEngine: unknown,
): GeneratedCampaignSetup {
  const normalizedSecretEngine =
    secretEngine && typeof secretEngine === "object" && !Array.isArray(secretEngine)
      ? (secretEngine as Record<string, unknown>)
      : {};
  const keyLocations = normalizeKeyLocations(normalizedSecretEngine.keyLocations);

  return {
    publicSynopsis: publicSynopsis as GeneratedCampaignSetup["publicSynopsis"],
    secretEngine: {
      ...(normalizedSecretEngine as GeneratedCampaignSetup["secretEngine"]),
      keyLocations:
        keyLocations.length > 0
          ? keyLocations
          : normalizeLegacyKeyLocations(normalizedSecretEngine.locations),
    },
  };
}
