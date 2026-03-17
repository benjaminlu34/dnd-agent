import { NextResponse } from "next/server";
import { createAdventure } from "@/lib/game/engine";

export const runtime = "nodejs";

export async function POST() {
  const snapshot = await createAdventure();
  return NextResponse.json({ snapshot });
}
