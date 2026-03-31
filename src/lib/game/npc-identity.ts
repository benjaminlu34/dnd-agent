type CanonicalNpcCandidate = {
  id: string;
  name?: string | null;
};

function normalizeSurface(value: string | null | undefined) {
  return (value ?? "").trim().toLowerCase();
}

function uniqueCandidateMatch(
  candidates: CanonicalNpcCandidate[],
  predicate: (candidate: CanonicalNpcCandidate) => boolean,
) {
  const matches = Array.from(
    new Map(
      candidates
        .filter(predicate)
        .map((candidate) => [candidate.id, candidate] as const),
    ).values(),
  );
  return matches.length === 1 ? matches[0]!.id : null;
}

export function canonicalizeNpcIdAgainstCandidates(input: {
  rawNpcId: string;
  candidates: CanonicalNpcCandidate[];
  phrase?: string;
}) {
  const trimmed = input.rawNpcId.trim();
  if (!trimmed) {
    return trimmed;
  }

  const normalized = trimmed.startsWith("npc:")
    ? trimmed.slice("npc:".length).trim()
    : trimmed;

  const exactId = uniqueCandidateMatch(input.candidates, (candidate) => candidate.id === normalized);
  if (exactId) {
    return exactId;
  }

  const prefixedId = `npc_${normalized}`;
  const prefixedMatch = uniqueCandidateMatch(input.candidates, (candidate) => candidate.id === prefixedId);
  if (prefixedMatch) {
    return prefixedMatch;
  }

  const normalizedLower = normalizeSurface(normalized);
  const exactName = uniqueCandidateMatch(
    input.candidates,
    (candidate) => normalizeSurface(candidate.name) === normalizedLower,
  );
  if (exactName) {
    return exactName;
  }

  const phraseLower = normalizeSurface(input.phrase);
  if (phraseLower) {
    const phraseName = uniqueCandidateMatch(
      input.candidates,
      (candidate) => normalizeSurface(candidate.name) === phraseLower,
    );
    if (phraseName) {
      return phraseName;
    }
  }

  const exactSuffix = uniqueCandidateMatch(
    input.candidates,
    (candidate) => candidate.id.endsWith(normalized),
  );
  if (exactSuffix) {
    return exactSuffix;
  }

  const npcSegmentIndex = normalized.lastIndexOf(":npc:");
  if (npcSegmentIndex >= 0) {
    const scopedSuffix = normalized.slice(npcSegmentIndex);
    const scopedSuffixMatch = uniqueCandidateMatch(
      input.candidates,
      (candidate) => candidate.id.endsWith(scopedSuffix),
    );
    if (scopedSuffixMatch) {
      return scopedSuffixMatch;
    }
  }

  const lastSegment = normalized.split(":").pop()?.trim() ?? "";
  if (lastSegment) {
    const finalSegmentMatch = uniqueCandidateMatch(input.candidates, (candidate) =>
      candidate.id.split(":").pop()?.trim() === lastSegment,
    );
    if (finalSegmentMatch) {
      return finalSegmentMatch;
    }
  }

  return normalized;
}
