import type { CampaignCharacter, CheckMode, CheckOutcome, CheckResult, Stat } from "@/lib/game/types";

function roll2d6() {
  return Math.ceil(Math.random() * 6) + Math.ceil(Math.random() * 6);
}

function outcomeForTotal(total: number): CheckOutcome {
  if (total >= 10) {
    return "success";
  }

  if (total >= 7) {
    return "partial";
  }

  return "failure";
}

export function rollCheck(input: {
  stat: Stat;
  mode: CheckMode;
  reason: string;
  character: CampaignCharacter;
  dc?: number;
}): CheckResult {
  const first = roll2d6();
  const second = roll2d6();

  let chosen = first;

  if (input.mode === "advantage") {
    chosen = Math.max(first, second);
  } else if (input.mode === "disadvantage") {
    chosen = Math.min(first, second);
  }

  const modifier = input.character.stats[input.stat];
  const total = chosen + modifier;
  const dc = input.dc;
  const outcome =
    typeof dc === "number"
      ? total >= dc
        ? "success"
        : total >= dc - 2
          ? "partial"
          : "failure"
      : outcomeForTotal(total);

  return {
    stat: input.stat,
    mode: input.mode,
    reason: input.reason,
    rolls: [first, second],
    modifier,
    total,
    dc,
    outcome,
    consequences:
      outcome === "failure"
        ? ["The situation worsens and tension rises."]
        : outcome === "partial"
          ? ["You get what you want, but not cleanly."]
          : ["Momentum shifts in your favor."],
  };
}
