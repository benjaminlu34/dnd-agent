import type { CampaignBlueprint, CampaignState } from "@/lib/game/types";

export function parseBlueprint(value: unknown) {
  return value as CampaignBlueprint;
}

export function parseCampaignState(value: unknown) {
  return value as CampaignState;
}
