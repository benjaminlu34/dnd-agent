import type {
  CheckResult,
  PendingCheck,
  PlayerCampaignSnapshot,
  TurnDigest,
  TurnResultPayload,
} from "@/lib/game/types";

export type StreamEvent =
  | { type: "narration"; chunk: string }
  | {
      type: "check_required";
      turnId: string;
      check: PendingCheck;
    }
  | {
      type: "check_result";
      result: CheckResult;
    }
  | { type: "clarification"; question: string; options: string[] }
  | { type: "actions"; actions: string[] }
  | { type: "state"; snapshot: PlayerCampaignSnapshot }
  | {
      type: "state_conflict";
      latestSnapshot: PlayerCampaignSnapshot | null;
      latestStateVersion: number;
      missedTurnDigests: TurnDigest[];
    }
  | {
      type: "retry_required";
      turnId: string;
      previousStatus: string;
      result: TurnResultPayload;
    }
  | {
      type: "invalid_expected_state_version";
      latestSnapshot: PlayerCampaignSnapshot | null;
      latestStateVersion: number;
      message: string;
    }
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
