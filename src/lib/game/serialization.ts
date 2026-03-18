import type {
  CampaignBlueprint,
  CampaignState,
  GeneratedCampaignSetup,
} from "@/lib/game/types";

export function parseBlueprint(value: unknown) {
  return value as CampaignBlueprint;
}

export function parseCampaignState(value: unknown) {
  return value as CampaignState;
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
