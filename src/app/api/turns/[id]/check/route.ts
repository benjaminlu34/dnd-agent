import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    {
      error: "Separate check resolution is no longer used in the spatial turn loop.",
    },
    { status: 410 },
  );
}
