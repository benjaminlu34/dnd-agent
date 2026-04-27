import type {
  CampaignRuntimeState,
  DerivedProgressionSummary,
  ProgressionFramework,
  ProgressionTrackDefinition,
} from "@/lib/game/types";

function clampTrackValue(value: number, track: ProgressionTrackDefinition) {
  let nextValue = value;
  if (track.min != null) {
    nextValue = Math.max(track.min, nextValue);
  }
  if (track.max != null) {
    nextValue = Math.min(track.max, nextValue);
  }
  return nextValue;
}

export function defaultProgressionTrackValues(
  framework: ProgressionFramework | null | undefined,
) {
  return Object.fromEntries(
    (framework?.tracks ?? []).map((track) => [
      track.id,
      clampTrackValue(track.defaultValue, track),
    ]),
  );
}

export function progressionTrackValue(
  track: ProgressionTrackDefinition,
  progression: CampaignRuntimeState["characterState"]["progression"] | null | undefined,
) {
  return clampTrackValue(progression?.trackValues[track.id] ?? track.defaultValue, track);
}

export function progressionTrackDefinitionMap(
  framework: ProgressionFramework | null | undefined,
) {
  return new Map((framework?.tracks ?? []).map((track) => [track.id, track]));
}

export function deriveProgressionSummary(input: {
  framework: ProgressionFramework | null | undefined;
  progression: CampaignRuntimeState["characterState"]["progression"] | null | undefined;
}): DerivedProgressionSummary | null {
  const tracks = input.framework?.tracks ?? [];
  if (!tracks.length) {
    return null;
  }

  const summaryTracks = tracks.map((track) => ({
    id: track.id,
    label: track.label,
    value: progressionTrackValue(track, input.progression),
    summary: track.summary,
  }));
  const primaryTrack =
    tracks.find((track) => track.id === input.framework?.primaryTrackId)
    ?? tracks.find((track) => (track.worldStandingScale ?? []).length > 0)
    ?? null;
  const primaryTrackValue = primaryTrack
    ? progressionTrackValue(primaryTrack, input.progression)
    : null;
  const standing = primaryTrack && primaryTrackValue != null
    ? [...(primaryTrack.worldStandingScale ?? [])]
        .sort((left, right) => right.minValue - left.minValue)
        .find((entry) => primaryTrackValue >= entry.minValue)
    : null;

  return {
    tracks: summaryTracks,
    worldStanding: standing
      ? {
          effectiveTierId: null,
          effectiveTierLabel: standing.effectiveTierLabel ?? null,
          relativeStanding: standing.relativeStanding,
        }
      : null,
  };
}

export function initializedProgressionState(
  framework: ProgressionFramework | null | undefined,
): CampaignRuntimeState["characterState"]["progression"] | undefined {
  const trackValues = defaultProgressionTrackValues(framework);
  return Object.keys(trackValues).length ? { trackValues } : undefined;
}
