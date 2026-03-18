import { NextResponse } from "next/server";
import { dmClient } from "@/lib/ai/provider";
import { toCampaignSeedCharacter } from "@/lib/game/characters";
import { campaignDraftRequestSchema } from "@/lib/game/session-zero";
import { createDefaultCharacterTemplate } from "@/lib/game/starter-data";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = campaignDraftRequestSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid draft request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const draft = await dmClient.generateCampaignSetup(
      toCampaignSeedCharacter(payload.data.character ?? createDefaultCharacterTemplate()),
      {
        basePrompt: payload.data.basePrompt,
        prompt: payload.data.prompt,
        previousDraft: payload.data.previousDraft,
      },
    );

    return NextResponse.json({ draft });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate campaign draft.",
      },
      { status: 500 },
    );
  }
}
