import type {
  CampaignBlueprint,
  CampaignState,
  GeneratedCampaignSetup,
} from "@/lib/game/types";

export function parseBlueprint(value: unknown) {
  return value as CampaignBlueprint;
}

export function parseCampaignState(value: unknown) {
  const state = value as CampaignState;
  const knownLocations = Array.isArray(state?.knownLocations)
    ? state.knownLocations
    : [state?.sceneState?.location];

  return {
    ...state,
    knownLocations: Array.from(
      new Set(
        knownLocations
          .filter((entry): entry is string => typeof entry === "string")
          .map((entry) => entry.trim())
          .filter(Boolean),
      ),
    ),
  } as CampaignState;
}

export function parseGeneratedCampaignSetup(
  publicSynopsis: unknown,
  secretEngine: unknown,
): GeneratedCampaignSetup {
  return {
    publicSynopsis: publicSynopsis as GeneratedCampaignSetup["publicSynopsis"],
    secretEngine: secretEngine as GeneratedCampaignSetup["secretEngine"],
  };
}
