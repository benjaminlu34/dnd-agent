import { NextResponse } from "next/server";
import { dmClient } from "@/lib/ai/provider";
import { characterAdaptRequestSchema } from "@/lib/game/characters";
import {
  getAdventureModuleWorldForUser,
  getCharacterConceptForUser,
} from "@/lib/game/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = characterAdaptRequestSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid character adaptation request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const [concept, module] = await Promise.all([
      getCharacterConceptForUser(payload.data.conceptId),
      getAdventureModuleWorldForUser(payload.data.moduleId),
    ]);

    if (!concept) {
      return NextResponse.json({ error: "Character concept not found." }, { status: 404 });
    }

    if (!module) {
      return NextResponse.json({ error: "Selected module was not found." }, { status: 404 });
    }

    const result = await dmClient.generateModuleCharacterTemplate({
      prompt: payload.data.prompt?.trim() || `Adapt ${concept.name} into this module as a playable character template.`,
      module,
      sourceConcept: concept,
    });

    return NextResponse.json({
      templateDraft: {
        ...result.character,
        moduleId: payload.data.moduleId,
        sourceConceptId: concept.id,
      },
      source: result.source,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to adapt character concept.",
      },
      { status: 500 },
    );
  }
}
