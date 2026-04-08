import type { CheckMode, CheckOutcome, CheckResult } from "@/lib/game/types";

function rollDie() {
  return Math.ceil(Math.random() * 6);
}

function rollPair(): [number, number] {
  return [rollDie(), rollDie()];
}

function pairTotal(pair: [number, number]) {
  return pair[0] + pair[1];
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

export function buildCheckResult(input: {
  approachId: string;
  mode: CheckMode;
  reason: string;
  modifier: number;
  rollPairs: Array<[number, number]>;
  dc?: number;
}): CheckResult {
  const [firstPair, secondPair] = input.rollPairs;
  let selectedRollPairIndex = 0;

  if (input.mode === "advantage" && secondPair && pairTotal(secondPair) > pairTotal(firstPair)) {
    selectedRollPairIndex = 1;
  } else if (input.mode === "disadvantage" && secondPair && pairTotal(secondPair) < pairTotal(firstPair)) {
    selectedRollPairIndex = 1;
  }

  const selectedTotal = pairTotal(input.rollPairs[selectedRollPairIndex]!);
  const total = selectedTotal + input.modifier;
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
    approachId: input.approachId,
    stat: input.approachId,
    mode: input.mode,
    reason: input.reason,
    rolls: input.rollPairs[selectedRollPairIndex],
    rollPairs: input.rollPairs,
    selectedRollPairIndex,
    modifier: input.modifier,
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

export function rollCheck(input: {
  approachId: string;
  mode: CheckMode;
  reason: string;
  modifier: number;
  dc?: number;
}): CheckResult {
  const rollPairs =
    input.mode === "normal"
      ? [rollPair()]
      : [rollPair(), rollPair()];

  return buildCheckResult({
    approachId: input.approachId,
    mode: input.mode,
    reason: input.reason,
    modifier: input.modifier,
    rollPairs,
    dc: input.dc,
  });
}
