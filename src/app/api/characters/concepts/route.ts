import { NextResponse } from "next/server";
import { listCharacterConcepts } from "@/lib/game/repository";

export const runtime = "nodejs";

export async function GET() {
  const concepts = await listCharacterConcepts();
  return NextResponse.json({ concepts });
}
