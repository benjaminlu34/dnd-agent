import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error: "Turn retry is not implemented in pass 1.",
    },
    { status: 410 },
  );
}
