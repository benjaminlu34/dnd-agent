import {
  getDraftGenerationProgress,
  subscribeToDraftGenerationProgress,
} from "@/lib/game/world-generation-progress";

export const runtime = "nodejs";

function encodeSseData(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const progressId = searchParams.get("progressId");

  if (!progressId) {
    return new Response("Missing progressId.", { status: 400 });
  }

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      const closeStream = () => {
        if (closed) {
          return;
        }

        closed = true;
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }

        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
      };
      const send = (payload: unknown) => {
        if (closed) {
          return;
        }

        controller.enqueue(encoder.encode(encodeSseData(payload)));
      };

      send({ type: "connected", progressId });

      const existing = getDraftGenerationProgress(progressId);
      if (existing) {
        send({ type: "progress", progress: existing });
      }

      const unsubscribe = subscribeToDraftGenerationProgress(progressId, (progress) => {
        send({ type: "progress", progress });

        if (progress.status === "complete" || progress.status === "error") {
          unsubscribe();
          closeStream();
        }
      });

      heartbeat = setInterval(() => {
        if (closed) {
          return;
        }

        try {
          controller.enqueue(encoder.encode(": keep-alive\n\n"));
        } catch {
          closeStream();
        }
      }, 15000);

      request.signal.addEventListener("abort", () => {
        unsubscribe();
        closeStream();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
