const SENSORY_FEEL_PATTERN =
  /\byou feel (?:the |a |an )?(?:cold|heat|pain|sting|weight|impact|pressure|texture|roughness|slickness|damp|wet|dryness|smell|odor|vibration|thrum|ache|wind|rain|stone|fabric|cloth|coat|blood|bruise|water|mud|splinters?|grit|dust|salt)\b/i;

const PSYCHOLOGICAL_FEEL_PATTERN =
  /\byou feel (?:confident|afraid|fearful|uneasy|certain|sure|ready|relief|guilt|hope|dread|anger|calm|nervous|brave|hesitant|reckless|cornered)\b/i;

const REPEATED_ITEM_WORDS = [
  "ledger",
  "relic",
  "idol",
  "amulet",
  "artifact",
  "key",
  "journal",
  "seal",
  "compass",
  "shard",
  "ring",
  "medallion",
  "map",
  "letter",
  "stone",
  "crown",
];

export type NarrationAuditMode = "opening" | "triage" | "resolution";

export type NarrationAuditIssue = {
  code:
    | "opening_recap"
    | "player_psychology"
    | "editorial_closer"
    | "summary_ending"
    | "repeated_key_item"
    | "action_deferral";
  message: string;
  directive: string;
  evidence?: string;
};

export type NarrationAuditInput = {
  mode: NarrationAuditMode;
  narration: string;
  playerAction?: string;
  recentCanon?: string[];
};

export type NarrationAuditResult = {
  issues: NarrationAuditIssue[];
  shouldRetry: boolean;
};

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function splitSentences(value: string) {
  return normalizeWhitespace(value)
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function issue(issue: NarrationAuditIssue): NarrationAuditIssue {
  return issue;
}

function detectOpeningRecap(narration: string) {
  const openingSlice = normalizeWhitespace(narration).slice(0, 240);

  if (
    /\b(you've been|you have been|for (?:three|two|several|\d+) days now|ever since|old habits rise|before the first decision is even made)\b/i.test(
      openingSlice,
    )
  ) {
    return issue({
      code: "opening_recap",
      message: "Opening starts with recap or backstory framing instead of immediate present action.",
      directive: "Remove the opening recap and start in the immediate external scene with a playable problem.",
      evidence: openingSlice,
    });
  }

  return null;
}

function detectPlayerPsychology(narration: string) {
  const psychologicalMarkers = [
    /\byou realize\b/i,
    /\byou know\b/i,
    /\byou suspect\b/i,
    /\byou understand\b/i,
    /\byou can'?t help but\b/i,
    /\byou(?:'re| are) not ready\b/i,
    PSYCHOLOGICAL_FEEL_PATTERN,
  ];

  for (const marker of psychologicalMarkers) {
    const match = narration.match(marker);
    if (match) {
      return issue({
        code: "player_psychology",
        message: "Narration ascribes the player's internal psychological state.",
        directive: "Do not ascribe the player's emotions, confidence, certainty, or realization. Show only external action or sensory detail.",
        evidence: match[0],
      });
    }
  }

  if (/\byou feel\b/i.test(narration) && !SENSORY_FEEL_PATTERN.test(narration)) {
    return issue({
      code: "player_psychology",
      message: "Narration uses 'you feel' in a way that is not clearly physical sensation.",
      directive: "Replace internal-feeling phrasing with external action, dialogue, or concrete sensory detail.",
      evidence: narration.match(/\byou feel\b/i)?.[0],
    });
  }

  return null;
}

function detectEditorialCloser(narration: string) {
  const lastSentence = splitSentences(narration).at(-1) ?? "";

  if (
    /\b(the night|the city|the dark|this place|the hunter|the hunted).*(always watching|never sleeps|always remembers|can always become)\b/i.test(
      lastSentence,
    ) ||
    /^the question isn't\b/i.test(lastSentence)
  ) {
    return issue({
      code: "editorial_closer",
      message: "Narration closes with an editorial or thematic statement.",
      directive: "Cut the thematic closing line and end on a concrete image, threat, or line of dialogue.",
      evidence: lastSentence,
    });
  }

  return null;
}

function detectSummaryEnding(narration: string) {
  const lastSentence = splitSentences(narration).at(-1) ?? "";

  if (
    /^(you (?:realize|learn|know)\b|these .* are just the beginning\b|whoever sent .* won't stop\b|the true cost of\b)/i.test(
      lastSentence,
    )
  ) {
    return issue({
      code: "summary_ending",
      message: "Narration ends by summarizing what the player learned instead of leaving it in the fiction.",
      directive: "Replace the summary ending with a concrete new pressure, image, or response in the scene.",
      evidence: lastSentence,
    });
  }

  return null;
}

function detectRepeatedKeyItem(narration: string, playerAction: string | undefined, recentCanon: string[]) {
  const lowerNarration = narration.toLowerCase();
  const lowerAction = (playerAction ?? "").toLowerCase();
  const canonText = recentCanon.join(" ").toLowerCase();

  for (const word of REPEATED_ITEM_WORDS) {
    const canonMatches = canonText.match(new RegExp(`\\b${word}\\b`, "g")) ?? [];

    if (canonMatches.length >= 2 && lowerNarration.includes(word) && !lowerAction.includes(word)) {
      return issue({
        code: "repeated_key_item",
        message: "Narration repeats the key item even though the current action does not engage with it.",
        directive: `Remove the unprompted ${word} reference unless it is directly handled, threatened, or newly revealed in this beat.`,
        evidence: word,
      });
    }
  }

  return null;
}

function detectActionDeferral(narration: string, playerAction: string | undefined) {
  if (!playerAction) {
    return null;
  }

  const lowerNarration = normalizeWhitespace(narration).toLowerCase();

  if (
    /\b(prepare(?:s|d)? (?:an|your)? ?ambush|ready to ambush|waiting for the perfect moment|need to decide whether|could follow .* or .* could|before they realize|not running anymore)\b/.test(
      lowerNarration,
    )
  ) {
    return issue({
      code: "action_deferral",
      message: "Narration turns a declared concrete action back into setup or indecision.",
      directive: "Resolve the declared action itself instead of deferring it into suspense or an option menu.",
      evidence: playerAction,
    });
  }

  return null;
}

export function auditNarration(input: NarrationAuditInput): NarrationAuditResult {
  const issues: NarrationAuditIssue[] = [];
  const narration = normalizeWhitespace(input.narration);

  if (!narration) {
    return { issues, shouldRetry: false };
  }

  if (input.mode === "opening") {
    const recap = detectOpeningRecap(narration);
    if (recap) {
      issues.push(recap);
    }
  }

  const psychology = detectPlayerPsychology(narration);
  if (psychology) {
    issues.push(psychology);
  }

  const closer = detectEditorialCloser(narration);
  if (closer) {
    issues.push(closer);
  }

  const ending = detectSummaryEnding(narration);
  if (ending) {
    issues.push(ending);
  }

  if (input.recentCanon?.length) {
    const keyItem = detectRepeatedKeyItem(narration, input.playerAction, input.recentCanon);
    if (keyItem) {
      issues.push(keyItem);
    }
  }

  if (input.mode !== "opening") {
    const deferral = detectActionDeferral(narration, input.playerAction);
    if (deferral) {
      issues.push(deferral);
    }
  }

  return {
    issues,
    shouldRetry: issues.length > 0,
  };
}

export function buildNarrationRetryInstructions(issues: NarrationAuditIssue[]) {
  return issues.map((entry) => `- ${entry.directive}`).join("\n");
}
