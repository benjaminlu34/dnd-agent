import { NextResponse } from "next/server";
import { dmClient } from "@/lib/ai/provider";
import { campaignDraftRequestSchema } from "@/lib/game/session-zero";
import { ensureSeedCharacter } from "@/lib/game/repository";

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
    const seededCharacter = await ensureSeedCharacter();
    const draft = await dmClient.generateCampaignSetup(
      {
        id: seededCharacter.id,
        name: seededCharacter.name,
        archetype: seededCharacter.archetype,
        stats: {
          strength: seededCharacter.strength,
          agility: seededCharacter.agility,
          intellect: seededCharacter.intellect,
          charisma: seededCharacter.charisma,
          vitality: seededCharacter.vitality,
        },
        maxHealth: seededCharacter.maxHealth,
        health: seededCharacter.health,
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
