import { NextResponse } from "next/server";
import { customEntryResolutionRequestSchema } from "@/lib/game/session-zero";
import { resolveCustomEntryPointForUser } from "@/lib/game/repository";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const payload = customEntryResolutionRequestSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (!payload.success) {
    return NextResponse.json(
      {
        error: "Invalid custom entry resolution request.",
        details: payload.error.flatten(),
      },
      { status: 400 },
    );
  }

  try {
    const result = await resolveCustomEntryPointForUser(payload.data);

    if ("error" in result) {
      if (result.error === "module_requires_descent") {
        return NextResponse.json(
          {
            error: "World-scale modules require region materialization before launch. This feature is pending.",
            code: "MODULE_REQUIRES_DESCENT",
          },
          { status: 409 },
        );
      }

      return NextResponse.json(
        {
          error:
            result.error === "module_not_found"
              ? "Selected adventure module was not found."
              : result.error === "template_incompatible"
                ? "Selected character template is not compatible with that module."
                : "Selected character template was not found.",
        },
        { status: result.error === "template_incompatible" ? 409 : 404 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to resolve custom entry.",
      },
      { status: 500 },
    );
  }
}
