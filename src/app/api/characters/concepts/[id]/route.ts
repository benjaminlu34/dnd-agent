import { NextResponse } from "next/server";
import { characterConceptDraftSchema } from "@/lib/game/characters";
import {
  deleteCharacterConceptForUser,
  getCharacterConceptForUser,
  updateCharacterConceptForUser,
} from "@/lib/game/repository";

export const runtime = "nodejs";

type Context = {
  params: Promise<{ id: string }>;
};

export async function GET(_: Request, context: Context) {
  const { id } = await context.params;
  const concept = await getCharacterConceptForUser(id);

  if (!concept) {
    return NextResponse.json({ error: "Character concept not found." }, { status: 404 });
  }

  return NextResponse.json({ concept });
}

export async function PATCH(request: Request, context: Context) {
  const { id } = await context.params;
  const payload = characterConceptDraftSchema.safeParse(await request.json().catch(() => null));

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid character concept update request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  const concept = await updateCharacterConceptForUser(id, payload.data);
  if (!concept) {
    return NextResponse.json({ error: "Character concept not found." }, { status: 404 });
  }

  return NextResponse.json({ conceptId: concept.id });
}

export async function DELETE(_: Request, context: Context) {
  const { id } = await context.params;
  const deleted = await deleteCharacterConceptForUser(id);

  if (!deleted) {
    return NextResponse.json({ error: "Character concept not found." }, { status: 404 });
  }

  return NextResponse.json(deleted);
}
