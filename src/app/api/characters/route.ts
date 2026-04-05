import { NextResponse } from "next/server";
import { listCharacterConcepts, listCharacterTemplates } from "@/lib/game/repository";

export const runtime = "nodejs";

export async function GET() {
  const [concepts, templates] = await Promise.all([
    listCharacterConcepts(),
    listCharacterTemplates(),
  ]);
  return NextResponse.json({ characters: templates, templates, concepts });
}
