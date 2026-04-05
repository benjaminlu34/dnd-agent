import { NextResponse } from "next/server";
import { characterConceptDraftSchema } from "@/lib/game/characters";
import { createCharacterConcept } from "@/lib/game/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = characterConceptDraftSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid character concept request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const concept = await createCharacterConcept(payload.data);
    return NextResponse.json({ conceptId: concept.id });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save character concept.",
      },
      { status: 500 },
    );
  }
}
