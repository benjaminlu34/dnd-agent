import { NextResponse } from "next/server";
import { dmClient } from "@/lib/ai/provider";
import { campaignDraftRequestSchema } from "@/lib/game/session-zero";
import { ensureDefaultCharacter } from "@/lib/game/repository";

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
    const defaultCharacter = await ensureDefaultCharacter();
    const draft = await dmClient.generateCampaignSetup(
      {
        id: defaultCharacter.id,
        name: defaultCharacter.name,
        archetype: defaultCharacter.archetype,
        stats: {
          strength: defaultCharacter.strength,
          agility: defaultCharacter.agility,
          intellect: defaultCharacter.intellect,
          charisma: defaultCharacter.charisma,
          vitality: defaultCharacter.vitality,
        },
        maxHealth: defaultCharacter.maxHealth,
        health: defaultCharacter.health,
      },
      {
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
