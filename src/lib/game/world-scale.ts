import type {
  DetailMode,
  ForbiddenDetailMode,
  LaunchBlockReason,
  ScaleProfile,
  TargetSemanticScale,
  WorldGenerationScalePlan,
  WorldScaleTier,
} from "@/lib/game/types";

export const WORLD_BIBLE_SCALE_MINIMUMS: Record<
  WorldScaleTier,
  { burdens: number; scars: number; sharedRealities: number }
> = {
  settlement: { burdens: 3, scars: 3, sharedRealities: 4 },
  regional: { burdens: 5, scars: 4, sharedRealities: 5 },
  world: { burdens: 5, scars: 5, sharedRealities: 5 },
};

export function launchBlockReasonForScale(scaleTier: WorldScaleTier): LaunchBlockReason {
  return scaleTier === "world" ? "requires_world_descent" : "none";
}

export function isScaleLaunchableDirectly(scaleTier: WorldScaleTier) {
  return launchBlockReasonForScale(scaleTier) === "none";
}

function createScaleProfile(input: {
  sourceScale: WorldScaleTier;
  targetSemanticScale: TargetSemanticScale;
  detailMode: DetailMode;
  forbiddenDetailModes: ForbiddenDetailMode[];
  launchableOutput: boolean;
  expectsChildDescent: boolean;
}): ScaleProfile {
  return {
    sourceScale: input.sourceScale,
    targetSemanticScale: input.targetSemanticScale,
    detailMode: input.detailMode,
    forbiddenDetailModes: input.forbiddenDetailModes,
    launchableOutput: input.launchableOutput,
    expectsChildDescent: input.expectsChildDescent,
  };
}

export function buildWorldGenerationScalePlan(scaleTier: WorldScaleTier): WorldGenerationScalePlan {
  const launchableDirectly = isScaleLaunchableDirectly(scaleTier);
  const launchBlockReason = launchBlockReasonForScale(scaleTier);

  if (scaleTier === "settlement") {
    return {
      entryScale: createScaleProfile({
        sourceScale: scaleTier,
        targetSemanticScale: "local",
        detailMode: "street_level",
        forbiddenDetailModes: ["full_geographic_enumeration", "cosmological_abstraction"],
        launchableOutput: true,
        expectsChildDescent: false,
      }),
      worldBibleScale: createScaleProfile({
        sourceScale: scaleTier,
        targetSemanticScale: "local",
        detailMode: "street_level",
        forbiddenDetailModes: ["full_geographic_enumeration", "cosmological_abstraction"],
        launchableOutput: true,
        expectsChildDescent: false,
      }),
      worldSpineScale: createScaleProfile({
        sourceScale: scaleTier,
        targetSemanticScale: "local",
        detailMode: "street_level",
        forbiddenDetailModes: ["full_geographic_enumeration", "cosmological_abstraction"],
        launchableOutput: true,
        expectsChildDescent: false,
      }),
      regionalLifeScale: createScaleProfile({
        sourceScale: scaleTier,
        targetSemanticScale: "local",
        detailMode: "street_level",
        forbiddenDetailModes: ["full_geographic_enumeration", "cosmological_abstraction"],
        launchableOutput: true,
        expectsChildDescent: false,
      }),
      socialCastScale: createScaleProfile({
        sourceScale: scaleTier,
        targetSemanticScale: "local",
        detailMode: "street_level",
        forbiddenDetailModes: ["single_room", "full_geographic_enumeration", "cosmological_abstraction"],
        launchableOutput: true,
        expectsChildDescent: false,
      }),
      knowledgeScale: createScaleProfile({
        sourceScale: scaleTier,
        targetSemanticScale: "local",
        detailMode: "street_level",
        forbiddenDetailModes: ["full_geographic_enumeration", "cosmological_abstraction"],
        launchableOutput: true,
        expectsChildDescent: false,
      }),
      expectsChildDescent: false,
      launchableDirectly,
      launchBlockReason,
    };
  }

  if (scaleTier === "regional") {
    return {
      entryScale: createScaleProfile({
        sourceScale: scaleTier,
        targetSemanticScale: "regional",
        detailMode: "territorial",
        forbiddenDetailModes: ["single_room", "cosmological_abstraction"],
        launchableOutput: true,
        expectsChildDescent: false,
      }),
      worldBibleScale: createScaleProfile({
        sourceScale: scaleTier,
        targetSemanticScale: "regional",
        detailMode: "territorial",
        forbiddenDetailModes: ["single_room", "cosmological_abstraction"],
        launchableOutput: true,
        expectsChildDescent: false,
      }),
      worldSpineScale: createScaleProfile({
        sourceScale: scaleTier,
        targetSemanticScale: "regional",
        detailMode: "territorial",
        forbiddenDetailModes: ["single_room", "single_business", "cosmological_abstraction"],
        launchableOutput: true,
        expectsChildDescent: false,
      }),
      regionalLifeScale: createScaleProfile({
        sourceScale: scaleTier,
        targetSemanticScale: "regional",
        detailMode: "territorial",
        forbiddenDetailModes: ["single_room", "cosmological_abstraction"],
        launchableOutput: true,
        expectsChildDescent: false,
      }),
      socialCastScale: createScaleProfile({
        sourceScale: scaleTier,
        targetSemanticScale: "regional",
        detailMode: "territorial",
        forbiddenDetailModes: ["single_room", "single_street_address", "cosmological_abstraction"],
        launchableOutput: true,
        expectsChildDescent: false,
      }),
      knowledgeScale: createScaleProfile({
        sourceScale: scaleTier,
        targetSemanticScale: "regional",
        detailMode: "territorial",
        forbiddenDetailModes: ["cosmological_abstraction"],
        launchableOutput: true,
        expectsChildDescent: false,
      }),
      expectsChildDescent: false,
      launchableDirectly,
      launchBlockReason,
    };
  }

  return {
    entryScale: createScaleProfile({
      sourceScale: scaleTier,
      targetSemanticScale: "regional",
      detailMode: "territorial",
      forbiddenDetailModes: [
        "single_room",
        "single_business",
        "single_street_address",
        "micro_neighborhood",
      ],
      launchableOutput: false,
      expectsChildDescent: true,
    }),
    worldBibleScale: createScaleProfile({
      sourceScale: scaleTier,
      targetSemanticScale: "civilizational",
      detailMode: "civilizational",
      forbiddenDetailModes: [
        "single_business",
        "single_street_address",
        "micro_neighborhood",
        "full_geographic_enumeration",
      ],
      launchableOutput: false,
      expectsChildDescent: true,
    }),
    worldSpineScale: createScaleProfile({
      sourceScale: scaleTier,
      targetSemanticScale: "civilizational",
      detailMode: "civilizational",
      forbiddenDetailModes: [
        "single_business",
        "single_street_address",
        "micro_neighborhood",
        "full_geographic_enumeration",
      ],
      launchableOutput: false,
      expectsChildDescent: true,
    }),
    regionalLifeScale: createScaleProfile({
      sourceScale: scaleTier,
      targetSemanticScale: "regional",
      detailMode: "territorial",
      forbiddenDetailModes: ["single_room", "single_business", "single_street_address"],
      launchableOutput: false,
      expectsChildDescent: true,
    }),
    socialCastScale: createScaleProfile({
      sourceScale: scaleTier,
      targetSemanticScale: "regional",
      detailMode: "territorial",
      forbiddenDetailModes: ["single_room", "single_business", "single_street_address"],
      launchableOutput: false,
      expectsChildDescent: true,
    }),
    knowledgeScale: createScaleProfile({
      sourceScale: scaleTier,
      targetSemanticScale: "civilizational",
      detailMode: "civilizational",
      forbiddenDetailModes: ["single_room", "single_business", "single_street_address"],
      launchableOutput: false,
      expectsChildDescent: true,
    }),
    expectsChildDescent: true,
    launchableDirectly,
    launchBlockReason,
  };
}
