import { NextResponse } from "next/server";
import { listCharacterTemplates } from "@/lib/game/repository";

export const runtime = "nodejs";

export async function GET() {
  const characters = await listCharacterTemplates();
  return NextResponse.json({ characters });
}
