import { NextResponse } from "next/server";
import { createAdventure } from "@/lib/game/engine";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    ok: true,
    message: "Adventure creation is a POST endpoint. Open / to use the app UI.",
  });
}

export async function POST() {
  const snapshot = await createAdventure();
  return NextResponse.json({ snapshot });
}
