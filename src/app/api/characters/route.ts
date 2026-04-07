import { NextResponse } from "next/server";
import { buildCharacterTemplateDraftSchema } from "@/lib/game/characters";
import { listCharacterConcepts, listCharacterTemplates } from "@/lib/game/repository";
import {
  createCharacterTemplate,
  getAdventureModuleWorldForUser,
} from "@/lib/game/repository";

export const runtime = "nodejs";

export async function GET() {
  const [concepts, templates] = await Promise.all([
    listCharacterConcepts(),
    listCharacterTemplates(),
  ]);
  return NextResponse.json({ characters: templates, templates, concepts });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null) as { moduleId?: string } | null;
  if (!body?.moduleId) {
    return NextResponse.json(
      {
        error: "Module-bound character templates require a moduleId.",
      },
      { status: 400 },
    );
  }

  try {
    const module = await getAdventureModuleWorldForUser(body.moduleId);
    if (!module) {
      return NextResponse.json({ error: "Selected module was not found." }, { status: 404 });
    }

    const payload = buildCharacterTemplateDraftSchema(module.characterFramework!).safeParse(body);
    if (!payload.success) {
      return NextResponse.json(
        {
          error: "Invalid character creation request.",
          details: payload.error.flatten(),
        },
        { status: 400 },
      );
    }

    const template = await createCharacterTemplate(payload.data);
    return NextResponse.json({ templateId: template.id });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to save character.",
      },
      { status: 500 },
    );
  }
}
