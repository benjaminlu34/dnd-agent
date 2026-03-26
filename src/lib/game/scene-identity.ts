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
