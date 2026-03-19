import {
  type ArcRecord,
  type CampaignBlueprint,
  type GeneratedCampaignOpening,
  type CampaignState,
  type Clue,
  type GeneratedCampaignSetup,
  type Hook,
  type NpcRecord,
  type QuestSeedRecord,
} from "@/lib/game/types";
import { canonicalizeAnchorName, findKeyLocationByName } from "@/lib/game/location-utils";
import { createStarterState } from "@/lib/game/starter-data";
import { slugify } from "@/lib/utils";

const PUBLIC_NPC_ROLE_KEYWORDS = [
  "authority",
  "guard",
  "warden",
  "keeper",
  "steward",
  "marshal",
  "judge",
  "captain",
  "merchant",
  "seller",
  "smith",
  "scribe",
  "apothecary",
  "physician",
  "mason",
  "miller",
  "copyist",
];

function makeId(prefix: string, value: string, fallback: string) {
  const slug = slugify(value);
  return `${prefix}_${slug || fallback}`;
}

function normalizeReferenceKey(value: string) {
  return value
    .toLowerCase()
    .replace(/\b(a|an|the)\b/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNormalizedIdMap<T>(
  items: T[],
  keyOf: (item: T) => string,
  idOf: (item: T, index: number) => string,
) {
  const map = new Map<string, string>();

  items.forEach((item, index) => {
    const key = normalizeReferenceKey(keyOf(item));

    if (key && !map.has(key)) {
      map.set(key, idOf(item, index));
    }
  });

  return map;
}

function isPublicNpcRole(role: string) {
  const normalizedRole = role.trim().toLowerCase();
  return PUBLIC_NPC_ROLE_KEYWORDS.some((keyword) => normalizedRole.includes(keyword));
}

export function buildCampaignBlueprintFromSetup(
  setup: GeneratedCampaignSetup,
): CampaignBlueprint {
  const hooks: Hook[] = setup.secretEngine.hooks.map((hook, index) => ({
    id: makeId("hook", hook.text, `hook_${index + 1}`),
    text: hook.text,
    status: "open",
  }));

  const revealTitleToId = buildNormalizedIdMap(
    setup.secretEngine.reveals,
    (reveal) => reveal.title,
    (reveal, index) => makeId("reveal", reveal.title, `reveal_${index + 1}`),
  );
  const clueTextToId = buildNormalizedIdMap(
    setup.secretEngine.clues,
    (clue) => clue.text,
    (clue, index) => makeId("clue", clue.text, `clue_${index + 1}`),
  );
  const arcTitleToId = buildNormalizedIdMap(
    setup.secretEngine.arcs,
    (arc) => arc.title,
    (arc, index) => makeId("arc", arc.title, `arc_${index + 1}`),
  );

  return {
    premise: setup.publicSynopsis.premise,
    tone: setup.publicSynopsis.tone,
    setting: setup.publicSynopsis.setting,
    keyLocations: setup.secretEngine.keyLocations,
    villain: {
      name: setup.secretEngine.villain.name,
      motive: setup.secretEngine.villain.motive,
      progressClock: Math.max(6, Math.min(12, setup.secretEngine.villain.progressClock || 10)),
    },
    arcs: setup.secretEngine.arcs.map((arc, index) => ({
      id:
        arcTitleToId.get(normalizeReferenceKey(arc.title)) ??
        makeId("arc", arc.title, `arc_${index + 1}`),
      title: arc.title,
      summary: arc.summary,
      expectedTurns: Math.max(4, Math.min(14, arc.expectedTurns || 8)),
    })),
    hiddenReveals: setup.secretEngine.reveals.map((reveal, index) => ({
      id:
        revealTitleToId.get(normalizeReferenceKey(reveal.title)) ??
        makeId("reveal", reveal.title, `reveal_${index + 1}`),
      title: reveal.title,
      truth: reveal.truth,
      requiredClues: reveal.requiredClueTitles
        .map((title) => clueTextToId.get(normalizeReferenceKey(title)))
        .filter((value): value is string => Boolean(value)),
      requiredArcIds: reveal.requiredArcTitles
        .map((title) => arcTitleToId.get(normalizeReferenceKey(title)))
        .filter((value): value is string => Boolean(value)),
      triggered: false,
    })),
    subplotSeeds: setup.secretEngine.subplotSeeds.map((seed, index) => ({
      id: makeId("subplot", seed.title, `subplot_${index + 1}`),
      title: seed.title,
      hook: seed.hook,
    })),
    initialHooks: hooks,
  };
}

export function buildCampaignStateFromSetup(
  setup: GeneratedCampaignSetup,
  opening: GeneratedCampaignOpening,
): CampaignState {
  const blueprint = buildCampaignBlueprintFromSetup(setup);
  const openingKeyLocationName = findKeyLocationByName(
    setup.secretEngine.keyLocations,
    opening.scene.keyLocationName,
  )?.name ?? null;

  return createStarterState(blueprint, {
    openingScene: {
      id: makeId("scene", opening.scene.title, "opening"),
      title: opening.scene.title,
      summary: opening.scene.summary,
      location: opening.scene.location,
      keyLocationName: openingKeyLocationName,
      atmosphere: opening.scene.atmosphere,
      suggestedActions: opening.scene.suggestedActions.slice(0, 4),
    },
    activeThreat: opening.activeThreat,
    discoveredSceneLocations: [opening.scene.location],
    discoveredKeyLocationNames: Array.from(
      new Set(
        setup.secretEngine.keyLocations
          .filter((location) => location.isPublic)
          .map((location) => canonicalizeAnchorName(location.name))
          .concat(openingKeyLocationName ? [canonicalizeAnchorName(openingKeyLocationName)] : [])
          .map((key) => blueprint.keyLocations.find((location) => canonicalizeAnchorName(location.name) === key)?.name)
          .filter((value): value is string => Boolean(value)),
      ),
    ),
  });
}

export function buildQuestRecordsFromSetup(setup: GeneratedCampaignSetup): QuestSeedRecord[] {
  return setup.secretEngine.quests.map((quest, index) => ({
    id: makeId("quest", quest.title, `quest_${index + 1}`),
    title: quest.title,
    summary: quest.summary,
    stage: 0,
    maxStage: Math.max(1, quest.maxStage),
    status: "active",
    rewardGold: Math.max(0, quest.rewardGold),
    rewardItemName: quest.rewardItem ?? null,
    discoveredAtTurn: null,
  }));
}

export function buildArcRecordsFromBlueprint(blueprint: CampaignBlueprint): ArcRecord[] {
  return blueprint.arcs.map((arc, index) => ({
    id: arc.id,
    title: arc.title,
    summary: arc.summary,
    status: index === 0 ? "active" : "locked",
    expectedTurns: arc.expectedTurns,
    currentTurn: 0,
    orderIndex: index,
  }));
}

export function buildNpcRecordsFromSetup(setup: GeneratedCampaignSetup): NpcRecord[] {
  return setup.secretEngine.npcs.slice(0, 4).map((npc, index) => {
    const isCompanion = Boolean(npc.isCompanion) && index === 0
      ? true
      : Boolean(
          npc.isCompanion &&
            !setup.secretEngine.npcs.slice(0, index).some((entry) => entry.isCompanion),
        );

    return {
      id: makeId("npc", npc.name, `npc_${index + 1}`),
      name: npc.name,
      role: npc.role,
      status: npc.status ?? "present",
      isCompanion,
      approval: npc.approval ?? 0,
      personalHook: npc.personalHook ?? null,
      notes: npc.notes,
      discoveredAtTurn: isCompanion || isPublicNpcRole(npc.role) ? 0 : null,
    };
  });
}

export function buildClueRecordsFromSetup(
  setup: GeneratedCampaignSetup,
  blueprint: CampaignBlueprint,
): Clue[] {
  const revealTitleToId = buildNormalizedIdMap(
    blueprint.hiddenReveals,
    (reveal) => reveal.title,
    (reveal) => reveal.id,
  );

  return setup.secretEngine.clues.map((clue, index) => ({
    id: makeId("clue", clue.text, `clue_${index + 1}`),
    text: clue.text,
    source: clue.source,
    linkedRevealId:
      revealTitleToId.get(normalizeReferenceKey(clue.linkedRevealTitle)) ??
      blueprint.hiddenReveals[0]?.id ??
      "reveal_1",
    status: "hidden",
    discoveredAtTurn: null,
  }));
}
