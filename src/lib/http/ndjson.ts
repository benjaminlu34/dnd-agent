export type StreamEvent =
  | { type: "narration"; chunk: string }
  | {
      type: "check_required";
      turnId: string;
      check: {
        stat: string;
        mode: string;
        reason: string;
      };
    }
  | {
      type: "check_result";
      result: Record<string, unknown>;
    }
  | { type: "actions"; actions: string[] }
  | { type: "state"; snapshot: Record<string, unknown> }
  | { type: "warning"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

export function createNdjsonStream(
  run: (send: (event: StreamEvent) => void) => Promise<void>,
) {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const send = (event: StreamEvent) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        await run(send);
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : "Unknown streaming error.",
        });
      } finally {
        send({ type: "done" });
        controller.close();
      }
    },
  });
}
