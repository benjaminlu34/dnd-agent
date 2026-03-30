function normalizeSceneIdentityText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const genericRolePrefixes = new Set([
  "a",
  "an",
  "another",
  "current",
  "local",
  "nearby",
  "ordinary",
  "present",
  "random",
  "some",
  "the",
]);

const summaryStopWords = new Set([
  "about",
  "after",
  "already",
  "another",
  "around",
  "before",
  "being",
  "between",
  "could",
  "every",
  "from",
  "have",
  "into",
  "just",
  "local",
  "near",
  "over",
  "some",
  "their",
  "there",
  "these",
  "they",
  "this",
  "through",
  "under",
  "while",
  "with",
  "your",
]);

const focusStopWords = new Set([
  "the",
  "and",
  "for",
  "with",
  "into",
  "from",
  "your",
  "inside",
  "front",
  "back",
  "room",
  "area",
  "entrance",
]);

function canonicalRoleTokens(value: string) {
  const tokens = normalizeSceneIdentityText(value)
    .split(" ")
    .filter((token) => token.length >= 2);

  while (tokens[0] && genericRolePrefixes.has(tokens[0])) {
    tokens.shift();
  }

  return tokens.filter((token) => !genericRolePrefixes.has(token));
}

function summaryTokens(value: string) {
  return normalizeSceneIdentityText(value)
    .split(" ")
    .filter((token) => token.length >= 4 && !summaryStopWords.has(token));
}

function overlapRatio(left: string[], right: string[]) {
  if (!left.length || !right.length) {
    return 0;
  }

  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of left) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.min(left.length, right.length);
}

function focusTokens(value: string) {
  return normalizeSceneIdentityText(value)
    .split(" ")
    .filter((token) => token.length >= 3 && !focusStopWords.has(token));
}

function sharedPrefixLength(left: string, right: string) {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function editDistanceWithinLimit(left: string, right: string, limit: number) {
  if (left === right) {
    return true;
  }
  if (Math.abs(left.length - right.length) > limit) {
    return false;
  }

  const previous = new Array(right.length + 1).fill(0);
  const current = new Array(right.length + 1).fill(0);

  for (let j = 0; j <= right.length; j += 1) {
    previous[j] = j;
  }

  for (let i = 1; i <= left.length; i += 1) {
    current[0] = i;
    let rowMin = current[0];

    for (let j = 1; j <= right.length; j += 1) {
      const substitutionCost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + substitutionCost,
      );
      rowMin = Math.min(rowMin, current[j]);
    }

    if (rowMin > limit) {
      return false;
    }

    for (let j = 0; j <= right.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[right.length] <= limit;
}

function focusTokenMatchesCandidate(focusToken: string, candidateToken: string) {
  if (focusToken === candidateToken) {
    return true;
  }
  if (Math.min(focusToken.length, candidateToken.length) < 4) {
    return false;
  }
  if (sharedPrefixLength(focusToken, candidateToken) < 4) {
    return false;
  }
  return editDistanceWithinLimit(focusToken, candidateToken, 2);
}

export function canonicalSceneRoleSignature(value: string) {
  return canonicalRoleTokens(value).sort().join(" ");
}

export function sceneActorIdentityClearlyMatches(input: {
  candidateRole: string;
  existingRole: string;
  candidateSummary?: string | null;
  existingSummary?: string | null;
}) {
  const candidateRoleTokens = canonicalRoleTokens(input.candidateRole);
  const existingRoleTokens = canonicalRoleTokens(input.existingRole);
  const candidateRoleSignature = [...candidateRoleTokens].sort().join(" ");
  const existingRoleSignature = [...existingRoleTokens].sort().join(" ");

  if (candidateRoleSignature && candidateRoleSignature === existingRoleSignature) {
    return true;
  }

  const roleOverlap = overlapRatio(candidateRoleTokens, existingRoleTokens);
  if (
    roleOverlap === 1
    && Math.min(candidateRoleTokens.length, existingRoleTokens.length) >= 2
  ) {
    return true;
  }

  const candidateSummaryTokens = summaryTokens(input.candidateSummary ?? "");
  const existingSummaryTokens = summaryTokens(input.existingSummary ?? "");
  const summaryOverlap = overlapRatio(candidateSummaryTokens, existingSummaryTokens);

  if (summaryOverlap >= 0.6) {
    return true;
  }

  return roleOverlap >= 0.5 && summaryOverlap >= 0.34;
}

export function sceneFocusTokens(sceneFocus: { key: string; label: string } | null | undefined) {
  if (!sceneFocus) {
    return [];
  }

  return Array.from(
    new Set(focusTokens(`${sceneFocus.key} ${sceneFocus.label}`)),
  );
}

export function sceneActorMatchesFocus(input: {
  actor: {
    displayLabel: string;
    role: string;
    lastSummary?: string | null;
    focusKey?: string | null;
  };
  sceneFocus: { key: string; label: string } | null | undefined;
}) {
  if (!input.sceneFocus) {
    return true;
  }
  if (input.actor.focusKey && input.actor.focusKey !== input.sceneFocus.key) {
    return false;
  }
  if (input.actor.focusKey === input.sceneFocus.key) {
    return true;
  }

  const tokens = sceneFocusTokens(input.sceneFocus);
  if (!tokens.length) {
    return false;
  }

  const candidateTokens = normalizeSceneIdentityText(
    `${input.actor.displayLabel} ${input.actor.role} ${input.actor.lastSummary ?? ""}`,
  ).split(" ");
  return tokens.some((token) => candidateTokens.some((candidateToken) => focusTokenMatchesCandidate(token, candidateToken)));
}

export function sceneAspectMatchesFocus(input: {
  aspect: {
    label: string;
    state: string;
    focusKey?: string | null;
  };
  sceneFocus: { key: string; label: string } | null | undefined;
}) {
  if (!input.sceneFocus) {
    return true;
  }
  if (input.aspect.focusKey == null) {
    return true;
  }
  if (input.aspect.focusKey && input.aspect.focusKey !== input.sceneFocus.key) {
    return false;
  }
  if (input.aspect.focusKey === input.sceneFocus.key) {
    return true;
  }

  const tokens = sceneFocusTokens(input.sceneFocus);
  if (!tokens.length) {
    return false;
  }

  const haystack = normalizeSceneIdentityText(`${input.aspect.label} ${input.aspect.state}`);
  return tokens.some((token) => haystack.includes(token));
}
