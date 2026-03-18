import { isStat } from "@/lib/game/types";

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

const KEYWORD_STOPWORDS = new Set([
  "with",
  "from",
  "that",
  "this",
  "into",
  "your",
  "their",
  "about",
  "before",
  "after",
  "while",
  "through",
  "where",
  "there",
  "then",
  "them",
  "they",
  "have",
  "when",
  "what",
  "under",
  "over",
  "just",
  "only",
  "from",
]);

const HANDLING_VERB_PATTERN =
  /\b(carry|carrying|carried|hide|hiding|hidden|stash|stashing|stashed|slip|slipping|slipped|set|setting|placed?|place|placing|hold|holding|held|keep|keeping|kept|take|taking|took|grab|grabbing|grabbed|inspect|inspecting|inspected|examine|examining|examined|study|studying|studied|read|reading|open|opening|opened|close|closing|closed|conceal|concealing|concealed|move|moving|moved|tuck|tucking|tucked)\b/i;

const DIRECT_OBJECT_PATTERN = /\b(it|this|that|them)\b/i;
const REVEAL_OR_THREAT_PATTERN =
  /\b(reveal|reveals|revealed|expose|exposes|exposed|decode|decodes|decoded|mark|marks|marked|threaten|threatens|threatened|snatch|snatches|snatched|seize|seizes|seized|steal|steals|stole|stolen|hunt|hunts|hunted|target|targets|targeted)\b/i;

export type NarrationAuditMode = "opening" | "triage" | "resolution";
export type NarrationAuditSeverity = "warn" | "block";

export type NarrationAuditIssue = {
  code:
    | "opening_recap"
    | "player_psychology"
    | "editorial_closer"
    | "summary_ending"
    | "repeated_key_item"
    | "action_deferral"
    | "invalid_check"
    | "missing_action_resolution"
    | "missing_narration"
    | "irrelevant_key_item"
    | "beat_contradiction"
    | "stale_suggested_actions"
    | "suggested_actions_in_narration";
  severity: NarrationAuditSeverity;
  message: string;
  directive: string;
  evidence?: string;
};

export type NarrationAuditInput = {
  mode: NarrationAuditMode;
  narration: string;
  playerAction?: string;
};

export type NarrationAuditResult = {
  issues: NarrationAuditIssue[];
  shouldRetry: boolean;
  highestSeverity: "clean" | NarrationAuditSeverity;
};

export type TurnSuggestedActionGoal = {
  goal: string;
  target: string | null;
};

export type BeatValidationInput = {
  mode: Exclude<NarrationAuditMode, "opening">;
  playerAction: string;
  actionResolution: string;
  suggestedActionGoals: TurnSuggestedActionGoal[];
  requiresCheck?: boolean;
  check?: {
    stat?: string;
    mode?: string;
    reason?: string;
  } | null;
};

export type BeatValidationResult = {
  issues: NarrationAuditIssue[];
  highestSeverity: "clean" | NarrationAuditSeverity;
  directlyHandledItems: string[];
};

export type RenderedNarrationAuditInput = {
  mode: Exclude<NarrationAuditMode, "opening">;
  narration: string;
  playerAction: string;
  actionResolution: string;
  directlyHandledItems: string[];
  suggestedActions: string[];
};

export type RenderedNarrationStructureAuditInput = {
  narration: string;
  suggestedActions: string[];
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

function highestSeverity(issues: NarrationAuditIssue[]): "clean" | NarrationAuditSeverity {
  if (issues.some((entry) => entry.severity === "block")) {
    return "block";
  }

  if (issues.some((entry) => entry.severity === "warn")) {
    return "warn";
  }

  return "clean";
}

function tokenizeKeywords(value: string) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 4 && !KEYWORD_STOPWORDS.has(token));
}

function keywordOverlap(left: string, right: string) {
  const a = new Set(tokenizeKeywords(left));
  const b = new Set(tokenizeKeywords(right));

  if (!a.size || !b.size) {
    return 0;
  }

  let overlap = 0;
  for (const token of a) {
    if (b.has(token)) {
      overlap += 1;
    }
  }

  return overlap;
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
      severity: "warn",
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
        severity: "warn",
        message: "Narration ascribes the player's internal psychological state.",
        directive: "Do not ascribe the player's emotions, confidence, certainty, or realization. Show only external action or sensory detail.",
        evidence: match[0],
      });
    }
  }

  if (/\byou feel\b/i.test(narration) && !SENSORY_FEEL_PATTERN.test(narration)) {
    return issue({
      code: "player_psychology",
      severity: "warn",
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
      severity: "warn",
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
      severity: "warn",
      message: "Narration ends by summarizing what the player learned instead of leaving it in the fiction.",
      directive: "Replace the summary ending with a concrete new pressure, image, or response in the scene.",
      evidence: lastSentence,
    });
  }

  return null;
}

function detectActionDeferral(text: string, playerAction: string | undefined) {
  if (!playerAction) {
    return null;
  }

  const lowerText = normalizeWhitespace(text).toLowerCase();

  if (
    /\b(prepare(?:s|d)? (?:an|your)? ?ambush|ready to ambush|waiting for the perfect moment|need to decide whether|could follow .* or .* could|before they realize|not running anymore|moment to breathe|plan your next move|plan the next move|gather your thoughts)\b/.test(
      lowerText,
    )
  ) {
    return issue({
      code: "action_deferral",
      severity: "block",
      message: "Narration or beat summary turns a declared concrete action back into setup or indecision.",
      directive: "Resolve the declared action itself instead of deferring it into suspense or an option menu.",
      evidence: playerAction,
    });
  }

  return null;
}

function mentionsItemWithVerb(text: string, item: string) {
  return new RegExp(
    `(?:${HANDLING_VERB_PATTERN.source})[^.]{0,48}\\b${item}\\b|\\b${item}\\b[^.]{0,48}(?:${HANDLING_VERB_PATTERN.source})`,
    "i",
  ).test(text);
}

function inferDirectlyHandledItems(playerAction: string, actionResolution: string) {
  const lowerAction = playerAction.toLowerCase();
  const lowerResolution = actionResolution.toLowerCase();
  const directlyHandledItems: string[] = [];
  const actionHandlesPronoun = HANDLING_VERB_PATTERN.test(lowerAction) && DIRECT_OBJECT_PATTERN.test(lowerAction);

  for (const word of REPEATED_ITEM_WORDS) {
    const mentionsInAction = new RegExp(`\\b${word}\\b`, "i").test(lowerAction);
    const mentionsInResolution = new RegExp(`\\b${word}\\b`, "i").test(lowerResolution);

    if (!mentionsInResolution) {
      continue;
    }

    if (
      mentionsInAction ||
      actionHandlesPronoun
    ) {
      directlyHandledItems.push(word);
    }
  }

  return directlyHandledItems;
}

function detectInvalidCheck(check: BeatValidationInput["check"]) {
  if (!check) {
    return issue({
      code: "invalid_check",
      severity: "block",
      message: "Planner required a check but did not return a valid check payload.",
      directive: "Return a complete check payload with stat, mode, and reason whenever requiresCheck is true.",
    });
  }

  if (!isStat(check.stat)) {
    return issue({
      code: "invalid_check",
      severity: "block",
      message: "Planner returned an invalid check stat.",
      directive:
        "Use one of strength, dexterity, constitution, intelligence, wisdom, or charisma for the check stat.",
      evidence: String(check.stat ?? ""),
    });
  }

  if (
    check.mode !== "normal" &&
    check.mode !== "advantage" &&
    check.mode !== "disadvantage"
  ) {
    return issue({
      code: "invalid_check",
      severity: "block",
      message: "Planner returned an invalid check mode.",
      directive: "Use one of normal, advantage, or disadvantage for the check mode.",
      evidence: String(check.mode ?? ""),
    });
  }

  if (!check.reason?.trim()) {
    return issue({
      code: "invalid_check",
      severity: "block",
      message: "Planner returned an empty check reason.",
      directive: "Provide a short reason describing what the check is resolving.",
    });
  }

  return null;
}

function detectMissingActionResolution(actionResolution: string) {
  if (!normalizeWhitespace(actionResolution)) {
    return issue({
      code: "missing_action_resolution",
      severity: "block",
      message: "Planner did not provide an actionResolution summary.",
      directive: "Provide a short mechanical summary of what this beat resolves or what the unresolved check is about.",
    });
  }

  return null;
}

function detectIrrelevantKeyItem(
  actionResolution: string,
  directlyHandledItems: string[],
) {
  const lowerResolution = actionResolution.toLowerCase();

  for (const word of REPEATED_ITEM_WORDS) {
    if (!new RegExp(`\\b${word}\\b`, "i").test(lowerResolution)) {
      continue;
    }

    if (directlyHandledItems.includes(word) || REVEAL_OR_THREAT_PATTERN.test(lowerResolution)) {
      continue;
    }

    return issue({
      code: "irrelevant_key_item",
      severity: "block",
      message: "The beat plan introduces a key item without direct handling, threat, or reveal context.",
      directive: `Remove the ${word} from actionResolution unless the beat directly handles it or materially changes its status.`,
      evidence: word,
    });
  }

  return null;
}

function detectBeatContradiction(narration: string, actionResolution: string) {
  const resolutionTokens = tokenizeKeywords(actionResolution);
  if (resolutionTokens.length < 2) {
    return null;
  }

  const overlap = keywordOverlap(narration, actionResolution);
  if (overlap > 0) {
    return null;
  }

  return issue({
    code: "beat_contradiction",
    severity: "block",
    message: "Rendered narration does not appear to reflect the validated beat resolution.",
    directive: "Rewrite the narration so it clearly depicts the validated actionResolution and nothing contradictory.",
    evidence: actionResolution,
  });
}

function detectRepeatedKeyItem(
  narration: string,
  directlyHandledItems: string[],
) {
  const lowerNarration = narration.toLowerCase();

  for (const word of REPEATED_ITEM_WORDS) {
    const narrationMatches = lowerNarration.match(new RegExp(`\\b${word}\\b`, "g")) ?? [];

    if (narrationMatches.length >= 2) {
      return issue({
        code: "repeated_key_item",
        severity: "warn",
        message: "Narration repeats the key item within the beat instead of keeping it in the background.",
        directive: `Reduce the repeated ${word} mentions and keep it in the background unless this beat materially changes its status.`,
        evidence: word,
      });
    }

    if (narrationMatches.length === 1 && !directlyHandledItems.includes(word)) {
      return issue({
        code: "repeated_key_item",
        severity: "warn",
        message: "Narration introduces the key item without a clear causal connection to the validated beat.",
        directive: `Remove the unprompted ${word} reference unless the validated beat directly handles, threatens, or reveals it.`,
        evidence: word,
      });
    }
  }

  return null;
}

function detectStaleSuggestedActions(
  suggestedActions: string[],
  playerAction: string,
  actionResolution: string,
) {
  if (suggestedActions.length < 2) {
    return issue({
      code: "stale_suggested_actions",
      severity: "warn",
      message: "Rendered output returned too few suggested actions to keep momentum.",
      directive: "Return 2-4 concrete next moves that follow from the resolved beat.",
    });
  }

  for (const action of suggestedActions) {
    if (
      normalizeWhitespace(action).toLowerCase() === normalizeWhitespace(playerAction).toLowerCase() ||
      keywordOverlap(action, playerAction) >= 2
    ) {
      return issue({
        code: "stale_suggested_actions",
        severity: "warn",
        message: "Rendered suggested actions repeat or reopen the player's just-resolved action.",
        directive: "Replace stale suggested actions with concrete follow-ups that fit the new state.",
        evidence: action,
      });
    }

    if (keywordOverlap(action, actionResolution) === 0 && tokenizeKeywords(actionResolution).length >= 2) {
      return issue({
        code: "stale_suggested_actions",
        severity: "warn",
        message: "Rendered suggested actions do not appear to follow from the validated beat.",
        directive: "Keep suggested actions anchored to the new pressure or opportunity created by the beat.",
        evidence: action,
      });
    }
  }

  return null;
}

function detectSuggestedActionsLeak(narration: string) {
  const match = narration.match(
    /\b(?:suggested actions?|next actions?|next moves?)\s*:/i,
  );

  if (!match) {
    return null;
  }

  return issue({
    code: "suggested_actions_in_narration",
    severity: "block",
    message: "Rendered narration leaked a suggested-actions footer into player-facing prose.",
    directive: "Remove the suggested-actions footer from narration and return those options only in the structured suggestedActions field.",
    evidence: match[0].trim(),
  });
}

export function validateBeatPlan(input: BeatValidationInput): BeatValidationResult {
  const issues: NarrationAuditIssue[] = [];
  const actionResolution = normalizeWhitespace(input.actionResolution);
  const directlyHandledItems = inferDirectlyHandledItems(input.playerAction, actionResolution);

  const missingResolution = detectMissingActionResolution(actionResolution);
  if (missingResolution) {
    issues.push(missingResolution);
  }

  if (input.requiresCheck) {
    const invalidCheck = detectInvalidCheck(input.check);
    if (invalidCheck) {
      issues.push(invalidCheck);
    }
  }

  if (!input.requiresCheck) {
    const deferral = detectActionDeferral(actionResolution, input.playerAction);
    if (deferral) {
      issues.push(deferral);
    }
  }

  const irrelevantKeyItem = detectIrrelevantKeyItem(actionResolution, directlyHandledItems);
  if (irrelevantKeyItem) {
    issues.push(irrelevantKeyItem);
  }

  if (input.suggestedActionGoals.length === 0 && !input.requiresCheck) {
    issues.push(
      issue({
        code: "stale_suggested_actions",
        severity: "warn",
        message: "Planner did not provide any suggested action goals.",
        directive: "Provide 2-4 short next-beat intent goals after resolving the action.",
      }),
    );
  }

  return {
    issues,
    highestSeverity: highestSeverity(issues),
    directlyHandledItems,
  };
}

export function auditRenderedNarration(input: RenderedNarrationAuditInput): NarrationAuditResult {
  const issues: NarrationAuditIssue[] = [];
  const narration = normalizeWhitespace(input.narration);

  if (!narration) {
    issues.push(
      issue({
        code: "beat_contradiction",
        severity: "block",
        message: "Renderer returned no narration.",
        directive: "Return concrete narration that depicts the validated beat.",
      }),
    );
  } else {
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

    const keyItem = detectRepeatedKeyItem(narration, input.directlyHandledItems);
    if (keyItem) {
      issues.push(keyItem);
    }

    const deferral = detectActionDeferral(narration, input.playerAction);
    if (deferral) {
      issues.push(deferral);
    }

    const contradiction = detectBeatContradiction(narration, input.actionResolution);
    if (contradiction) {
      issues.push(contradiction);
    }

    const suggestedActionsLeak = detectSuggestedActionsLeak(narration);
    if (suggestedActionsLeak) {
      issues.push(suggestedActionsLeak);
    }
  }

  const staleSuggestedActions = detectStaleSuggestedActions(
    input.suggestedActions,
    input.playerAction,
    input.actionResolution,
  );
  if (staleSuggestedActions) {
    issues.push(staleSuggestedActions);
  }

  return {
    issues,
    shouldRetry: issues.length > 0,
    highestSeverity: highestSeverity(issues),
  };
}

export function auditRenderedNarrationStructure(
  input: RenderedNarrationStructureAuditInput,
): NarrationAuditResult {
  const issues: NarrationAuditIssue[] = [];
  const narration = normalizeWhitespace(input.narration);

  if (!narration) {
    issues.push(
      issue({
        code: "missing_narration",
        severity: "block",
        message: "Renderer returned no player-facing narration.",
        directive: "Return a non-empty narration field in the renderer tool payload.",
      }),
    );
  } else {
    const suggestedActionsLeak = detectSuggestedActionsLeak(narration);
    if (suggestedActionsLeak) {
      issues.push(suggestedActionsLeak);
    }
  }

  return {
    issues,
    shouldRetry: issues.length > 0,
    highestSeverity: highestSeverity(issues),
  };
}

export function auditNarration(input: NarrationAuditInput): NarrationAuditResult {
  const issues: NarrationAuditIssue[] = [];
  const narration = normalizeWhitespace(input.narration);

  if (!narration) {
    return { issues, shouldRetry: false, highestSeverity: "clean" };
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

  const directlyHandledItems =
    input.mode === "opening"
      ? []
      : REPEATED_ITEM_WORDS.filter((word) => {
          const lowerAction = (input.playerAction ?? "").toLowerCase();
          const mentionsInAction = new RegExp(`\\b${word}\\b`, "i").test(lowerAction);
          const actionHandlesPronoun = HANDLING_VERB_PATTERN.test(lowerAction) && DIRECT_OBJECT_PATTERN.test(lowerAction);

          return mentionsInAction || (actionHandlesPronoun && new RegExp(`\\b${word}\\b`, "i").test(narration));
        });
  const keyItem = detectRepeatedKeyItem(narration, directlyHandledItems);
  if (keyItem) {
    issues.push(keyItem);
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
    highestSeverity: highestSeverity(issues),
  };
}

export function buildNarrationRetryInstructions(issues: NarrationAuditIssue[]) {
  return issues.map((entry) => `- ${entry.directive}`).join("\n");
}

export function auditSceneSnapshot(summary: string) {
  const normalized = normalizeWhitespace(summary);
  const issues: string[] = [];

  if (!normalized) {
    return {
      shouldCompress: false,
      issues,
    };
  }

  if (/\n\s*\n|\r\n\s*\r\n/.test(summary)) {
    issues.push("paragraph_breaks");
  }

  if (detectPlayerPsychology(normalized)) {
    issues.push("player_psychology");
  }

  if (detectEditorialCloser(normalized)) {
    issues.push("editorial_closer");
  }

  if (detectSummaryEnding(normalized)) {
    issues.push("summary_ending");
  }

  if (detectOpeningRecap(normalized)) {
    issues.push("opening_recap");
  }

  return {
    shouldCompress: issues.length > 0,
    issues,
  };
}
