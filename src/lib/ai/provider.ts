import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages/messages";
import { env } from "@/lib/env";
import {
  buildDungeonMasterSystemPrompt,
  buildOutcomeUserPrompt,
  buildTriageUserPrompt,
  isResolveDecision,
  isTriageDecision,
  resolutionTool,
  triageTool,
} from "@/lib/game/prompts";
import { createStarterBlueprint } from "@/lib/game/starter-data";
import type {
  CampaignBlueprint,
  CheckOutcome,
  CheckResult,
  PromptContext,
  ResolveDecision,
  TriageDecision,
} from "@/lib/game/types";

type StreamCallbacks = {
  onNarration?: (chunk: string) => void;
};

type AnthropicToolResult = {
  text: string;
  toolInput: unknown;
};

type StreamEvent = {
  type: string;
  content_block?: {
    type?: string;
  };
  delta?: {
    type?: string;
    text?: string;
    partial_json?: string;
  };
};

type TurnAIPayload = {
  blueprint: CampaignBlueprint;
  promptContext: PromptContext;
  playerAction: string;
};

class MockDungeonMaster {
  async generateCampaignBlueprint() {
    return createStarterBlueprint();
  }

  async triageTurn(input: TurnAIPayload, callbacks?: StreamCallbacks): Promise<TriageDecision> {
    const action = input.playerAction.toLowerCase();
    const requiresCheck =
      /(attack|strike|fight|break|force|sneak|convince|persuade|climb|leap|grab)/.test(action);

    if (!requiresCheck) {
      const narration = `You press the moment forward in ${input.promptContext.scene.title.toLowerCase()}, and the town answers with one more unsettling detail tied to your goal.`;
      callbacks?.onNarration?.(narration);

      const clueToDiscover = input.promptContext.relevantClues.find((clue) => clue.status === "hidden");

      return {
        requiresCheck: false,
        suggestedActions: [
          "Press the advantage before the cult regroups",
          "Question someone who noticed the disturbance",
          "Follow the newest lead into the next district",
        ],
        proposedDelta: {
          sceneSummary: narration,
          tensionDelta: 4,
          villainClockDelta: 1,
          clueDiscoveries: clueToDiscover ? [clueToDiscover.id] : [],
          suggestedActions: [
            "Press the advantage before the cult regroups",
            "Question someone who noticed the disturbance",
            "Follow the newest lead into the next district",
          ],
          arcAdvancements: input.promptContext.activeArc
            ? [{ arcId: input.promptContext.activeArc.id, currentTurnDelta: 1 }]
            : [],
        },
      };
    }

    const stat = action.includes("convince") || action.includes("persuade")
      ? "charisma"
      : action.includes("sneak")
        ? "agility"
        : action.includes("climb") || action.includes("leap")
          ? "vitality"
          : "strength";

    return {
      requiresCheck: true,
      check: {
        stat,
        mode: "normal",
        reason: `Resolving: ${input.playerAction}`,
      },
      suggestedActions: [],
      proposedDelta: {},
    };
  }

  async resolveTurn(
    input: TurnAIPayload & { checkResult: CheckResult },
    callbacks?: StreamCallbacks,
  ): Promise<ResolveDecision> {
    const toneByOutcome: Record<CheckOutcome, string> = {
      success:
        "Your move lands cleanly, and the pressure in the scene briefly breaks in your favor.",
      partial:
        "You get forward motion, but the win comes with exposed nerves and a fresh complication.",
      failure:
        "The move backfires hard enough to sharpen the danger around you.",
    };

    const narration = `${toneByOutcome[input.checkResult.outcome]} ${input.promptContext.companion ? `${input.promptContext.companion.name} reacts under their breath as the scene shifts.` : ""}`.trim();
    callbacks?.onNarration?.(narration);

    const remainingHiddenClue = input.promptContext.relevantClues.find((clue) => clue.status === "hidden");
    const revealId = input.promptContext.eligibleRevealIds[0];

    return {
      suggestedActions: [
        "Push deeper while the opening lasts",
        "Regroup and read the room",
        "Question your companion about what just changed",
      ],
      proposedDelta: {
        sceneSummary: narration,
        tensionDelta: input.checkResult.outcome === "failure" ? 10 : 5,
        villainClockDelta: input.checkResult.outcome === "failure" ? 1 : 0,
        clueDiscoveries:
          input.checkResult.outcome !== "failure" && remainingHiddenClue
            ? [remainingHiddenClue.id]
            : [],
        revealTriggers: input.checkResult.outcome === "success" && revealId ? [revealId] : [],
        suggestedActions: [
          "Push deeper while the opening lasts",
          "Regroup and read the room",
          "Question your companion about what just changed",
        ],
        arcAdvancements: input.promptContext.activeArc
          ? [{ arcId: input.promptContext.activeArc.id, currentTurnDelta: 1 }]
          : [],
        npcApprovalChanges: input.promptContext.companion
          ? [
              {
                npcId: input.promptContext.companion.id,
                approvalDelta: input.checkResult.outcome === "failure" ? -1 : 1,
                reason: "Shared danger reshaped the bond.",
              },
            ]
          : [],
      },
    };
  }

  async summarizeSession(messages: string[]) {
    return `Previously on: ${messages.slice(-3).join(" ").slice(0, 220)}`;
  }

  async generatePreviouslyOn(summary: string, scene: string, clueText: string[]) {
    return `Previously on: ${summary} Now the story resumes in ${scene} with ${clueText[0] ?? "old secrets"} still unresolved.`;
  }
}

class AnthropicDungeonMaster {
  private client = new Anthropic({
    apiKey: env.anthropicApiKey,
  });

  private async runStream(input: {
    prompt: string;
    tool: Tool;
    onNarration?: (chunk: string) => void;
  }): Promise<AnthropicToolResult> {
    const stream = await this.client.messages.create({
      model: env.anthropicModel,
      max_tokens: 900,
      system: buildDungeonMasterSystemPrompt(),
      tools: [input.tool],
      tool_choice: { type: "auto" },
      messages: [
        {
          role: "user",
          content: input.prompt,
        },
      ],
      stream: true,
    });

    let text = "";
    let toolInput = "";
    let capturingTool = false;

    for await (const rawEvent of stream as AsyncIterable<unknown>) {
      const event = rawEvent as StreamEvent;

      if (event.type === "content_block_start") {
        capturingTool = event.content_block?.type === "tool_use";
      }

      if (event.type === "content_block_delta") {
        if (event.delta?.type === "text_delta") {
          const chunk = event.delta.text ?? "";
          text += chunk;
          input.onNarration?.(chunk);
        }

        if (event.delta?.type === "input_json_delta") {
          toolInput += event.delta.partial_json ?? "";
        }
      }

      if (event.type === "content_block_stop" && capturingTool) {
        capturingTool = false;
      }
    }

    return {
      text,
      toolInput: toolInput ? JSON.parse(toolInput) : null,
    };
  }

  async generateCampaignBlueprint() {
    return createStarterBlueprint();
  }

  async triageTurn(input: TurnAIPayload, callbacks?: StreamCallbacks): Promise<TriageDecision> {
    const result = await this.runStream({
      prompt: buildTriageUserPrompt(input),
      tool: triageTool as unknown as Tool,
      onNarration: callbacks?.onNarration,
    });

    if (!isTriageDecision(result.toolInput)) {
      throw new Error("Model returned an invalid triage payload.");
    }

    return result.toolInput;
  }

  async resolveTurn(
    input: TurnAIPayload & { checkResult: CheckResult },
    callbacks?: StreamCallbacks,
  ): Promise<ResolveDecision> {
    const result = await this.runStream({
      prompt: buildOutcomeUserPrompt(input),
      tool: resolutionTool as unknown as Tool,
      onNarration: callbacks?.onNarration,
    });

    if (!isResolveDecision(result.toolInput)) {
      throw new Error("Model returned an invalid resolution payload.");
    }

    return result.toolInput;
  }

  async summarizeSession(messages: string[]) {
    const response = await this.client.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 180,
      messages: [
        {
          role: "user",
          content: `Summarize this session in 2-3 sentences for future prompt context:\n${messages.join("\n")}`,
        },
      ],
    });

    const text = response.content.find((block) => block.type === "text");
    return text?.text ?? "The session summary could not be generated.";
  }

  async generatePreviouslyOn(summary: string, scene: string, clueText: string[]) {
    const response = await this.client.messages.create({
      model: "claude-3-5-haiku-latest",
      max_tokens: 120,
      messages: [
        {
          role: "user",
          content: `Previous session summary: ${summary}\nCurrent scene: ${scene}\nClues unresolved: ${clueText.join(", ") || "none"}\n\nWrite a dramatic two-sentence "Previously on..." recap.`,
        },
      ],
    });

    const text = response.content.find((block) => block.type === "text");
    return text?.text ?? `Previously on: ${summary}`;
  }
}

export const dmClient = env.anthropicApiKey
  ? new AnthropicDungeonMaster()
  : new MockDungeonMaster();
