import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error: "Pending-turn editing is not supported in the spatial turn loop.",
    },
    { status: 410 },
  );
}
