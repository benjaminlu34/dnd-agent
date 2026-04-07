import { NextResponse } from "next/server";
import { dmClient } from "@/lib/ai/provider";
import { characterTemplateGenerateRequestSchema } from "@/lib/game/characters";
import { getAdventureModuleWorldForUser } from "@/lib/game/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = characterTemplateGenerateRequestSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid character generation request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    if (!payload.data.moduleId) {
      const result = await dmClient.generateCharacterConcept(payload.data.prompt);
      return NextResponse.json(result);
    }

    const module = await getAdventureModuleWorldForUser(payload.data.moduleId);
    if (!module) {
      return NextResponse.json(
        { error: "Selected module was not found." },
        { status: 404 },
      );
    }

    const result = await dmClient.generateModuleCharacterTemplate({
      prompt: payload.data.prompt,
      module,
    });
    return NextResponse.json({
      character: {
        ...result.character,
        moduleId: payload.data.moduleId,
        frameworkVersion: module.characterFramework!.frameworkVersion,
      },
      source: result.source,
    });
  } catch (error) {
    console.error("[characters/generate] Error:", error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate character.",
      },
      { status: 500 },
    );
  }
}
