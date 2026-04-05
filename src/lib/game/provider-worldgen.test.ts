import assert from "node:assert/strict";
import test from "node:test";
import { aiProviderTestUtils } from "../ai/provider";
import {
  generatedKnowledgeThreadsInputSchema,
  generatedRegionalLifeSchema,
  generatedSocialLayerInputSchema,
} from "./session-zero";
import type { OpenWorldGenerationCheckpoint, PromptIntentProfile } from "./types";

test("normalizeSocialCastInput dedupes and clamps social ties so schema-sized overflows recover", () => {
  const normalized = aiProviderTestUtils.normalizeSocialCastInput(
    {
      npcs: [
        {
          name: "Thalos Stormrider",
          role: "Wild Magic Scholar",
          summary: "A mage obsessed with studying chaotic ruins.",
          description: "He camps in a shattered observatory and records every surge.",
          factionId: "fac_red_wizards_of_thay",
          currentLocationId: "loc_blackmoor_ruins_of_power",
          approval: 0,
          isCompanion: false,
          currentConcern: "Another surge is about to tear through his camp.",
          publicContactSurface: "He works the permit desk that logs salvage crews before the next collapse.",
          ties: {
            locationIds: [
              "loc_blackmoor_ruins_of_power",
              "loc_blackmoor_ruins_of_power",
              "loc_icewind_dale_icewind_pass",
            ],
            factionIds: [
              "fac_red_wizards_of_thay",
              "fac_red_wizards_of_thay",
              "fac_harper_network",
            ],
            economyHooks: "wild magic research; artifact salvage; artifact salvage",
            informationHooks:
              "ancient magic; wild magic surges; Blackmoor ruins; wild magic surges",
          },
          importance: "local",
          bridgeLocationIds:
            "loc_cormanthyr_whispering_woods, loc_icewind_dale_icewind_pass, loc_cormanthyr_whispering_woods",
          bridgeFactionIds: [
            "fac_red_wizards_of_thay",
            "fac_red_wizards_of_thay",
            "fac_harper_network",
          ],
        },
      ],
    },
    1,
  );

  const parsed = generatedSocialLayerInputSchema.safeParse(normalized);
  assert.equal(parsed.success, true);

  if (!parsed.success) {
    return;
  }

  assert.deepEqual(parsed.data.npcs[0].ties.locationIds, [
    "loc_blackmoor_ruins_of_power",
    "loc_icewind_dale_icewind_pass",
  ]);
  assert.deepEqual(parsed.data.npcs[0].ties.factionIds, [
    "fac_red_wizards_of_thay",
    "fac_harper_network",
  ]);
  assert.deepEqual(parsed.data.npcs[0].ties.economyHooks, [
    "wild magic research",
    "artifact salvage",
  ]);
  assert.deepEqual(parsed.data.npcs[0].ties.informationHooks, [
    "ancient magic",
    "wild magic surges",
  ]);
  assert.deepEqual(parsed.data.npcs[0].bridgeLocationIds, [
    "loc_cormanthyr_whispering_woods",
    "loc_icewind_dale_icewind_pass",
  ]);
  assert.deepEqual(parsed.data.npcs[0].bridgeFactionIds, [
    "fac_red_wizards_of_thay",
    "fac_harper_network",
  ]);
});

test("normalizeSchedulePayloadIds upgrades bare payload ids to campaign-scoped ids", () => {
  const normalized = aiProviderTestUtils.normalizeSchedulePayloadIds(
    {
      faction: "fac_waterdeep_authorities",
      targetNpcId: "npc_captain_thorne_waterdeep",
      informationId: "info_waterdeep_guild_rivalries",
      nested: {
        locationId: "loc_waterdeep",
      },
      untouched: "market_day",
    },
    {
      locations: new Map([["loc_waterdeep", "camp_123:location:loc_waterdeep"]]),
      factions: new Map([["fac_waterdeep_authorities", "camp_123:faction:fac_waterdeep_authorities"]]),
      npcs: new Map([["npc_captain_thorne_waterdeep", "camp_123:npc:npc_captain_thorne_waterdeep"]]),
      information: new Map([["info_waterdeep_guild_rivalries", "camp_123:information:info_waterdeep_guild_rivalries"]]),
    },
  ) as Record<string, unknown>;

  assert.deepEqual(normalized, {
    faction: "camp_123:faction:fac_waterdeep_authorities",
    targetNpcId: "camp_123:npc:npc_captain_thorne_waterdeep",
    informationId: "camp_123:information:info_waterdeep_guild_rivalries",
    nested: {
      locationId: "camp_123:location:loc_waterdeep",
    },
    untouched: "market_day",
  });
});

test("findCustomEntryIntentConflicts flags named-hook drift for routine ambient openings", () => {
  const conflicts = aiProviderTestUtils.findCustomEntryIntentConflicts({
    intent: {
      activityFrame: "routine_work",
      socialAnchorPreference: "ambient_locals",
      informationLeadPreference: "ambient_public",
      notes: "Routine smithy morning with ambient townsfolk and no named quest-giver.",
    },
    resolvedDraft: {
      title: "Anvil & Ember",
      summary: "A blacksmith starts the day at the forge.",
      startLocationId: "loc_waterdeep",
      presentNpcIds: ["npc_captain_thorne_waterdeep"],
      initialInformationIds: ["info_waterdeep_guild_rivalries"],
      immediatePressure: "The morning order still needs finishing before the customer returns.",
      publicLead: "Captain Thorne passes by and mentions smugglers at the docks.",
      localContactNpcId: "npc_captain_thorne_waterdeep",
      localContactTemporaryActorLabel: null,
      temporaryLocalActors: [],
      mundaneActionPath: "Finish the horseshoes and check the star-iron blade in the back corner.",
      evidenceWorldAlreadyMoving: "Bread carts and laborers are already moving along the street.",
    },
    validInformation: [
      {
        id: "info_waterdeep_guild_rivalries",
        title: "Guild Rivalries",
        sourceNpcId: "npc_captain_thorne_waterdeep",
      },
    ],
    validNpcs: [
      {
        id: "npc_captain_thorne_waterdeep",
        name: "Captain Thorne",
      },
    ],
  });

  assert.ok(conflicts.some((issue) => issue.includes("named NPC contact")));
  assert.ok(conflicts.some((issue) => issue.includes("ambient and public")));
  assert.ok(conflicts.some((issue) => issue.includes("observable street life")));
});

test("buildCustomEntryIntentCorrectionNotes preserves prior correction notes and intent guidance", () => {
  const correctionNotes = aiProviderTestUtils.buildCustomEntryIntentCorrectionNotes({
    priorCorrectionNotes: "Do not collapse into the stock Waterdeep debt hook.",
    intent: {
      activityFrame: "private_project",
      socialAnchorPreference: "ambient_locals",
      informationLeadPreference: "none",
      notes: "Personal craft project first, with ambient passersby but no named briefing.",
    },
    issues: [
      "Do not hinge the opening on a named NPC contact.",
      "Do not seed a formal information hook here.",
    ],
  });

  assert.match(correctionNotes, /stock Waterdeep debt hook/);
  assert.match(correctionNotes, /Personal craft project first/);
  assert.match(correctionNotes, /Do not hinge the opening on a named NPC contact/);
});

test("summarizeWorldBibleForPrompt tiers world bible context by stage distance", () => {
  const worldBible = {
    title: "Beneath the Rain",
    premise: "The rain never stops.",
    tone: "Melancholic",
    setting: "A drowned world",
    groundLevelReality: "Arrival means wet rope, ration lines, and a harbor that never quite stops arguing with itself.",
    widespreadBurdens: [
      "Burden one.",
      "Burden two.",
      "Burden three.",
      "Burden four.",
      "Burden five.",
      "Burden six.",
      "Burden seven.",
    ],
    presentScars: [
      "Scar one.",
      "Scar two.",
      "Scar three.",
      "Scar four.",
      "Scar five.",
      "Scar six.",
      "Scar seven.",
    ],
    sharedRealities: [
      "Detail one.",
      "Detail two.",
      "Detail three.",
      "Detail four.",
      "Detail five.",
      "Detail six.",
    ],
    explanationThreads: [
      {
        key: "exp_1",
        phenomenon: "Phenomenon one",
        prevailingTheories: ["Theory A", "Theory B"],
        actionableSecret: "Secret one",
      },
      {
        key: "exp_2",
        phenomenon: "Phenomenon two",
        prevailingTheories: ["Theory C", "Theory D"],
        actionableSecret: "Secret two",
      },
      {
        key: "exp_3",
        phenomenon: "Phenomenon three",
        prevailingTheories: ["Theory E", "Theory F"],
        actionableSecret: "Secret three",
      },
    ],
    everydayLife: {
      survival: "Survival detail.",
      institutions: ["Inst 1", "Inst 2", "Inst 3", "Inst 4", "Inst 5"],
      fears: ["Fear 1", "Fear 2", "Fear 3", "Fear 4"],
      wants: ["Want 1", "Want 2", "Want 3", "Want 4"],
      trade: ["Trade 1", "Trade 2", "Trade 3", "Trade 4", "Trade 5"],
      gossip: ["Gossip 1", "Gossip 2", "Gossip 3", "Gossip 4"],
    },
  };

  const worldSpineContext = aiProviderTestUtils.summarizeWorldBibleForPrompt(worldBible, "world_spine");
  const socialContext = aiProviderTestUtils.summarizeWorldBibleForPrompt(worldBible, "social_cast");
  const knowledgeContext = aiProviderTestUtils.summarizeWorldBibleForPrompt(worldBible, "knowledge_web");

  assert.equal(worldSpineContext.widespreadBurdens.length, 6);
  assert.equal(worldSpineContext.presentScars.length, 2);
  assert.equal(worldSpineContext.sharedRealities.length, 6);
  assert.equal(worldSpineContext.competingExplanations.length, 0);

  assert.equal(socialContext.widespreadBurdens.length, 4);
  assert.equal(socialContext.presentScars.length, 1);
  assert.equal(socialContext.sharedRealities.length, 5);
  assert.equal(socialContext.competingExplanations.length, 0);
  assert.equal(socialContext.everydayLife.gossip.length, 4);

  assert.equal(knowledgeContext.widespreadBurdens.length, 6);
  assert.equal(knowledgeContext.presentScars.length, 3);
  assert.equal(knowledgeContext.sharedRealities.length, 6);
  assert.equal(knowledgeContext.competingExplanations.length, 3);
});

test("shared worldgen prompt builder removes the old simulation-first worldview layer", () => {
  const promptIntentProfile: PromptIntentProfile = {
    primaryTextureModes: ["ritual_ceremonial", "mythic"],
    primaryCausalLogic: "ritual",
    magicIntegration: "spectacular",
    socialEmphasis: "mixed",
    confidence: "high",
  };

  const systemPrompt = aiProviderTestUtils.buildWorldGenSystemPrompt({
    stage: "world_bible",
    scaleTier: "world",
    userPrompt: "A world-spanning pilgrimage sea where drowned saints still answer bells.",
    promptIntentProfile,
    successLines: ["Keep the output scale-correct and vivid."],
  });

  assert.doesNotMatch(systemPrompt, /simulation-first/i);
  assert.doesNotMatch(systemPrompt, /Prioritize concrete survival, work, trade/i);
  assert.doesNotMatch(systemPrompt, /Translate the prompt into concrete systemic pressures/i);
  assert.match(systemPrompt, /Prompt intent guardrails:/);
  assert.match(systemPrompt, /ritual-ceremonial/);
  assert.match(systemPrompt, /present-tense and ongoing/i);
  assert.match(systemPrompt, /settlement: routines, upkeep, habits/i);
  assert.match(systemPrompt, /regional: circulation, jurisdiction, migration/i);
  assert.match(systemPrompt, /world: civilizational adaptation, shared systems/i);
  assert.match(systemPrompt, /Do not force every place, faction, or NPC to revolve around a ceremony, convoy, inspection, emergency, or discrete event/i);
});

test("world spine location instructions emphasize inhabited present-tense life without logistics overfitting", () => {
  const instructions = aiProviderTestUtils.buildWorldSpineLocationSuccessLines({
    scaleTier: "regional",
    worldSpineScaleProfile: {
      sourceScale: "regional",
      targetSemanticScale: "regional",
      detailMode: "territorial",
      forbiddenDetailModes: ["single_room"],
      launchableOutput: false,
      expectsChildDescent: false,
    },
    worldSpineLocationTarget: 12,
  }).join("\n");

  assert.match(instructions, /Every location should feel present-tense, inhabited, and already in use/i);
  assert.match(instructions, /Show ongoing use, dependence, adaptation, authority, reputation, labor, ritual, ecology, or circulation/i);
  assert.match(instructions, /Do not require every location to hinge on a convoy, inspection, emergency, or event-like public disruption/i);
  assert.doesNotMatch(instructions, /moving through it/i);
  assert.doesNotMatch(instructions, /being managed/i);
});

test("world spine batch instructions stay scale-aware outside world tier", () => {
  const regionalLines = aiProviderTestUtils.buildWorldSpineBatchFinalInstructionLines({
    scaleTier: "regional",
    batchIndex: 1,
    batchCount: 4,
  }).join("\n");
  const settlementLines = aiProviderTestUtils.buildWorldSpineBatchFinalInstructionLines({
    scaleTier: "settlement",
    batchIndex: 0,
    batchCount: 3,
  }).join("\n");

  assert.match(regionalLines, /Generate major regional locations/i);
  assert.doesNotMatch(regionalLines, /Generate major world locations/i);
  assert.match(settlementLines, /Generate major local locations/i);
  assert.doesNotMatch(settlementLines, /Generate major world locations/i);
});

test("critique instruction helpers include the new inertness, role-shell, and static-fact checks", () => {
  const worldBibleCritique = aiProviderTestUtils.buildWorldBibleCritiqueInstructions();
  const worldSpineCritique = aiProviderTestUtils.buildWorldSpineScaleCritiqueInstructions("regional");
  const socialCritique = aiProviderTestUtils.buildSocialCastScaleCritiqueInstructions("settlement");
  const knowledgeCritique = aiProviderTestUtils.buildKnowledgeWebCritiqueInstructions();

  assert.match(worldBibleCritique.system.join("\n"), /inertness/i);
  assert.match(worldBibleCritique.finalInstruction.join("\n"), /do not require overt drama, emergencies, or scripted events/i);

  assert.match(worldSpineCritique.finalInstruction.join("\n"), /postcard-like locations/i);
  assert.match(worldSpineCritique.finalInstruction.join("\n"), /Do not penalize a location merely for being stable, prosperous, ceremonially important, fertile, quiet, or socially central/i);

  assert.match(socialCritique.finalInstruction.join("\n"), /job shell/i);
  assert.match(socialCritique.finalInstruction.join("\n"), /private stake/i);
  assert.match(socialCritique.finalInstruction.join("\n"), /clerk, registrar, inspector/i);

  assert.match(knowledgeCritique.system.join("\n"), /entry point into something already happening/i);
  assert.match(knowledgeCritique.finalInstruction.join("\n"), /encyclopedia-like static fact dumps/i);
  assert.match(knowledgeCritique.finalInstruction.join("\n"), /procedural instruction sheets/i);
});

test("scale fallback correction notes stay on the requested tier", () => {
  const regionalWorldSpineFallback = aiProviderTestUtils.buildWorldSpineScaleFallbackCorrectionNotes(
    "regional",
    [
      {
        name: "Mistwater Factorum District",
      } as Parameters<typeof aiProviderTestUtils.buildWorldSpineScaleFallbackCorrectionNotes>[1][number],
    ],
  ).join("\n");
  const settlementSocialFallback = aiProviderTestUtils.buildSocialCastScaleFallbackCorrectionNotes(
    "settlement",
  ).join("\n");

  assert.match(regionalWorldSpineFallback, /regional scale/i);
  assert.doesNotMatch(regionalWorldSpineFallback, /world scale/i);
  assert.match(settlementSocialFallback, /settlement scale/i);
  assert.doesNotMatch(settlementSocialFallback, /At world scale/i);
});

test("regional life and knowledge threads schemas allow calmer optional arrays", () => {
  const regionalLifeParsed = generatedRegionalLifeSchema.safeParse({
    locations: [
      {
        locationId: "loc_1",
        publicActivity: "Market day repairs continue.",
        dominantActivities: ["repairs", "trading"],
        localPressure: "Timber arrives late after the thaw.",
        classTexture: "Boat crews and ledger families share the quay uneasily.",
        everydayTexture: "Tar smoke hangs over the piers.",
        publicHazards: ["slick docks"],
        ordinaryKnowledge: ["Which pier floods first", "Which foreman pays fairly"],
        institutions: ["Harbor board"],
        gossip: ["The bell-ringers skipped a watch"],
        reasonsToLinger: ["Reliable ferry work"],
        routineSeeds: ["Morning cargo weighing"],
        eventSeeds: [],
      },
    ],
  });
  const knowledgeThreadsParsed = generatedKnowledgeThreadsInputSchema.safeParse({
    knowledgeNetworks: [],
    pressureSeeds: [],
  });

  assert.equal(regionalLifeParsed.success, true);
  assert.equal(knowledgeThreadsParsed.success, true);
});

test("knowledge-web truncation recovery no longer forces one node per location", () => {
  const issues = aiProviderTestUtils.buildStageTruncationRecoveryIssues("knowledge_web").join("\n");

  assert.match(issues, /meaningful knowledge presence for every location/i);
  assert.doesNotMatch(issues, /one information node per location/i);
});

test("prompt-intent system prompt does not seed intent guardrails before inference", () => {
  const systemPrompt = aiProviderTestUtils.buildWorldGenSystemPrompt({
    stage: "prompt_intent",
    scaleTier: "world",
    userPrompt: "A masked court drifting through impossible mirrors.",
    successLines: ["Infer only the prompt's generation intent."],
  });

  assert.doesNotMatch(systemPrompt, /Prompt intent guardrails:/);
  assert.doesNotMatch(systemPrompt, /institutional/);
  assert.match(systemPrompt, /Current stage: prompt_intent\./);
});

test("resume invalidation restarts worldgen from prompt_intent when prompt architecture version is stale", () => {
  const staleCheckpoint: OpenWorldGenerationCheckpoint = {
    prompt: "A masked court drifting through impossible mirrors.",
    model: "test-model",
    createdAt: "2026-04-04T00:00:00.000Z",
    scaleTier: "world",
    scalePlan: {
      entryScale: {
        sourceScale: "world",
        targetSemanticScale: "civilizational",
        detailMode: "civilizational",
        forbiddenDetailModes: ["single_room"],
        launchableOutput: false,
        expectsChildDescent: true,
      },
      worldBibleScale: {
        sourceScale: "world",
        targetSemanticScale: "civilizational",
        detailMode: "civilizational",
        forbiddenDetailModes: ["single_room"],
        launchableOutput: false,
        expectsChildDescent: true,
      },
      worldSpineScale: {
        sourceScale: "world",
        targetSemanticScale: "civilizational",
        detailMode: "civilizational",
        forbiddenDetailModes: ["single_room"],
        launchableOutput: false,
        expectsChildDescent: true,
      },
      regionalLifeScale: {
        sourceScale: "world",
        targetSemanticScale: "civilizational",
        detailMode: "civilizational",
        forbiddenDetailModes: ["single_room"],
        launchableOutput: false,
        expectsChildDescent: true,
      },
      socialCastScale: {
        sourceScale: "world",
        targetSemanticScale: "civilizational",
        detailMode: "civilizational",
        forbiddenDetailModes: ["single_room"],
        launchableOutput: false,
        expectsChildDescent: true,
      },
      knowledgeScale: {
        sourceScale: "world",
        targetSemanticScale: "civilizational",
        detailMode: "civilizational",
        forbiddenDetailModes: ["single_room"],
        launchableOutput: false,
        expectsChildDescent: true,
      },
      expectsChildDescent: true,
      launchableDirectly: false,
      launchBlockReason: "requires_world_descent",
    },
    promptIntentProfile: {
      primaryTextureModes: ["courtly_status"],
      primaryCausalLogic: "mixed",
      magicIntegration: "integrated",
      socialEmphasis: "private_networks",
      confidence: "high",
    },
    promptArchitectureVersion: aiProviderTestUtils.CURRENT_PROMPT_ARCHITECTURE_VERSION - 1,
    generationStatus: "failed",
    failedStage: "world_spine",
    completedStages: ["prompt_intent", "world_bible", "world_spine"],
    lastGenerationError: "stale prompt layer",
    stageArtifacts: {
      prompt_intent: {
        primaryTextureModes: ["courtly_status"],
        primaryCausalLogic: "mixed",
        magicIntegration: "integrated",
        socialEmphasis: "private_networks",
        confidence: "high",
      },
      world_bible: {
        title: "Glass Court",
        premise: "A mirrored court drifts between worlds.",
        tone: "Opulent and strange",
        setting: "A moving mirror dominion",
        groundLevelReality: "Courtiers live by reflections and invitation chains.",
        widespreadBurdens: ["Invitation debts", "Mirror tolls", "Reputation spirals"],
        presentScars: ["A broken coronation", "A sealed gallery", "A vanished fleet"],
        sharedRealities: ["Silver etiquette", "Masked audiences", "Tidal reflections"],
        explanationThreads: [],
        everydayLife: {
          survival: "Status and shelter hinge on invitations.",
          institutions: ["The Mask Court", "Mirror Ushers", "House Vellum", "The Tide Choir"],
          fears: ["Public unmasking", "Broken passage", "Patron ruin"],
          wants: ["An invitation", "A clean reflection", "A remembered favor"],
          trade: ["Mirror silk", "Invitation wax", "Bell glass"],
          gossip: ["A duke crossed the wrong reflection.", "The choir skipped a bell.", "A mask was returned empty."],
        },
      },
      world_spine: {
        locations: [],
        edges: [],
        factions: [],
        factionRelations: [],
      },
    },
    attempts: [
      {
        stage: "prompt_intent",
        attempt: 1,
        correctionNotes: null,
        completedAt: "2026-04-04T00:00:00.000Z",
      },
      {
        stage: "world_spine",
        attempt: 2,
        correctionNotes: "old correction",
        completedAt: "2026-04-04T00:01:00.000Z",
      },
    ],
    validationReports: [
      {
        stage: "world_spine",
        attempt: 2,
        ok: false,
        category: "coherence",
        issues: ["old issue"],
      },
    ],
    idMaps: {
      factions: {},
      locations: {},
      edges: {},
      factionRelations: {},
      npcs: {},
      information: {},
      commodities: {},
    },
    stageSummaries: {
      prompt_intent: "old",
      world_bible: "old",
      world_spine: "old",
    },
  };

  const normalized = aiProviderTestUtils.normalizeWorldGenerationResumeCheckpoint({
    resumeCheckpoint: staleCheckpoint,
    prompt: staleCheckpoint.prompt,
    scaleTier: staleCheckpoint.scaleTier,
    model: staleCheckpoint.model,
  });

  assert.equal(normalized.promptArchitectureVersion, aiProviderTestUtils.CURRENT_PROMPT_ARCHITECTURE_VERSION);
  assert.equal(normalized.stageArtifacts.prompt_intent, undefined);
  assert.equal(normalized.stageArtifacts.world_bible, undefined);
  assert.equal(normalized.stageArtifacts.world_spine, undefined);
  assert.equal(normalized.promptIntentProfile, undefined);
  assert.deepEqual(normalized.completedStages, []);
  assert.equal(normalized.failedStage, null);
  assert.equal(normalized.lastGenerationError, null);
  assert.equal(normalized.generationStatus, "running");
  assert.deepEqual(normalized.attempts, []);
  assert.deepEqual(normalized.validationReports, []);
});

test("knowledge-web validation allows guarded ceremonial knowledge without public-action quotas", () => {
  const issues = aiProviderTestUtils.validateKnowledgeWebStage({
    information: [
      {
        key: "info_bell",
        title: "Bell sequence",
        summary: "The court opens only after the third bell.",
        content: "The third bell opens the audience route.",
        truthfulness: "true",
        accessibility: "guarded",
        locationId: "loc_court",
        factionId: null,
        sourceNpcId: "npc_usher",
        actionLead: "Watch the bell gallery at dusk.",
        knowledgeThread: null,
        discoverHow: "Attend evening rehearsal twice and note the pauses.",
      },
      {
        key: "info_glass",
        title: "Mirror etiquette",
        summary: "Servants avoid direct address in the glass wards.",
        content: "Names spoken into the mirrors travel farther than intended.",
        truthfulness: "partial",
        accessibility: "guarded",
        locationId: null,
        factionId: null,
        sourceNpcId: "npc_steward",
        actionLead: "Offer to carry the ward cloths.",
        knowledgeThread: null,
        discoverHow: "Help with evening preparations and listen for corrections.",
      },
    ],
    lockedLocations: [
      { id: "loc_court", name: "The Glass Court" },
      { id: "loc_gallery", name: "The Bell Gallery" },
    ],
    lockedFactions: [{ id: "fac_house" }],
    lockedNpcs: [
      { id: "npc_usher", currentLocationId: "loc_court" },
      { id: "npc_steward", currentLocationId: "loc_gallery" },
    ],
  });

  assert.deepEqual(issues, []);
});
