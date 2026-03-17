import { NextResponse } from "next/server";
import { characterTemplateDraftSchema } from "@/lib/game/characters";
import {
  deleteCharacterTemplateForUser,
  getCharacterTemplateForUser,
  updateCharacterTemplateForUser,
} from "@/lib/game/repository";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;

  try {
    const character = await getCharacterTemplateForUser(id);

    if (!character) {
      return NextResponse.json(
        { error: "Character template not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ character });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load character template.",
      },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const payload = characterTemplateDraftSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid character update request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const character = await updateCharacterTemplateForUser(id, payload.data);

    if (!character) {
      return NextResponse.json(
        { error: "Character template not found." },
        { status: 404 },
      );
    }

    return NextResponse.json({ templateId: character.id });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to update character template.",
      },
      { status: 500 },
    );
  }
}

export async function DELETE(_: Request, context: Context) {
  const { id } = await context.params;

  try {
    const deleted = await deleteCharacterTemplateForUser(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Character template not found." },
        { status: 404 },
      );
    }

    return NextResponse.json(deleted);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to delete character template.",
      },
      { status: 500 },
    );
  }
}
