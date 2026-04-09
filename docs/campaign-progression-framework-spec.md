# Campaign Progression Framework Spec

## Summary

The engine needs a first-class way to track long-form character progression that is specific to a campaign fantasy and meaningful relative to the world.

Today the system can represent:

- static identity through `frameworkValues`, stats, and character framing
- temporary runtime state through `characterState.conditions`, companions, and vitality

What it cannot represent well is the middle layer:

- persistent, fantasy-specific progression that changes across turns
- progression that is not just a temporary condition
- progression that can be compared to the world’s canonical scale

This document defines a generic **Campaign Progression Framework** for campaign playthroughs.

The full feature vision is:

- campaigns/modules can define progression tracks for a character fantasy
- campaigns/modules can optionally define progression paths
- campaigns/modules can optionally define canonical world ladders
- the engine persists raw progression values in runtime state
- prompt context exposes a compact progression summary to planning, narration, and suggestions
- the engine can optionally derive a world-relative standing from that state

This spec intentionally separates:

- the **full feature architecture**
- the **v1 implementation slice**

The implementation agent should build only the v1 slice first. The broader architecture stays in the spec so we can grow into it cleanly after the first proof.

## Problem

### Current representation

The codebase currently has a useful but incomplete split:

- static character identity and authored framing
- runtime conditions and lightweight state
- AI-generated narration and mechanics

Relevant code:

- [`CampaignRuntimeState`](/home/blu34/projects/dnd-agent/src/lib/game/types.ts:1094)
- [`GeneratedWorldModule.characterFramework`](/home/blu34/projects/dnd-agent/src/lib/game/types.ts:956)
- [`update_character_state` mutation](/home/blu34/projects/dnd-agent/src/lib/game/types.ts:2166)
- [`buildTurnUserPrompt`](/home/blu34/projects/dnd-agent/src/lib/ai/provider.ts:6047)
- [`SpatialPromptContext`](/home/blu34/projects/dnd-agent/src/lib/game/types.ts:1534)

### Why that breaks down

This leaves no durable place for progression such as:

- hidden corruption
- divine favor
- blood hunger
- aether mastery
- social ascent
- mutation strain
- deviant power growth

As a result:

- important progression gets flattened into prose
- important progression gets forced into one-off conditions
- later turns often cannot see or reason about prior advancement
- the game cannot easily answer “how strong is this character relative to the world?”

That is the gap this feature should fill.

## Design Goals

- Support fantasy-specific progression across any campaign/module combination.
- Keep progression additive to existing stats, vitality, and conditions.
- Preserve raw state in durable runtime storage and derive prompt views from it.
- Allow campaigns to express “world-relative standing” when that concept exists.
- Keep the system generic enough for non-combat, non-magic, and non-hidden-power fantasies.
- Avoid hardcoding campaign-specific progression logic into engine code.

## Non-Goals

- replacing stats or vitality
- replacing conditions
- shipping a full UI system in the first pass
- hardcoding abyssal, divine, political, or other fantasy-specific logic in engine code
- forcing every campaign to have a canonical ladder
- implementing the full long-term surface area in v1

## Core Model

The correct abstraction is a layered one.

### 1. Identity

Static or slow-changing authored character facts.

Examples:

- lineage
- oath
- background
- hidden nature
- tradition

This mostly already exists in framework-facing character data.

### 2. Conditions

Short-lived or categorical runtime statuses.

Examples:

- poisoned
- disguised
- exhausted
- empowered
- hunted

This already exists in `characterState.conditions`.

### 3. Progression Tracks

Persistent, mutable values that represent the character’s long-form fantasy progression.

Examples:

- corruption
- hunger
- favor
- resonance
- instability
- influence
- debt
- assimilation
- heat
- oath strain

This is the missing layer.

### 4. Optional Progression Paths

A path describes the way a character advances.

Examples:

- orthodox aether cultivation
- abyssal assimilation
- divine patronage
- bloodline awakening
- political accumulation
- cursed transformation

Paths are useful metadata, but not required for the core feature to work.

### 5. Optional World Ladder

A canonical world-recognized scale of advancement.

Examples:

- Kindled -> higher tiers -> godhood
- novice -> adept -> master
- laborer -> officer -> ruler

Not every campaign needs this. When a campaign does have it, the game can derive a world-relative interpretation from progression state.

### 6. Optional World-Relative Standing

A concise interpretation of what the progression state means relative to the world.

Examples:

- “Below most trained delvers, above ordinary laborers”
- “Equivalent to an early Kindled despite bypassing orthodox training”
- “Not politically dominant yet, but already more feared than a normal magistrate”

This is the piece that answers the campaign-play question:

“How is this character’s unique growth scaling relative to the rest of the world?”

## Full Feature Architecture

This section describes the full intended architecture, not the initial implementation boundary.

### Definitions

The long-term feature should support authored progression definitions at the campaign/module layer.

For this codebase, the natural authored home is a new optional sibling field on [`GeneratedWorldModule`](/home/blu34/projects/dnd-agent/src/lib/game/types.ts:956), parallel to `characterFramework`.

Recommended long-term field name:

- `progressionFramework`

Recommended shape:

```ts
type ProgressionTrackDefinition = {
  id: string;
  label: string;
  summary: string;
  kind: "meter" | "tier" | "counter" | "boolean";
  min?: number;
  max?: number;
  step?: number;
  defaultValue: number | boolean | string;
};

type ProgressionPathDefinition = {
  id: string;
  label: string;
  summary: string;
  trackIds: string[];
  ladderId?: string | null;
  advancementMethod?: string | null;
};

type ProgressionLadderDefinition = {
  id: string;
  label: string;
  summary: string;
  tiers: Array<{
    id: string;
    label: string;
    order: number;
    summary: string;
  }>;
};
```

These definitions should live with authored module/campaign data, not inside engine-specific rules.

In practice that means:

- extend [`GeneratedWorldModule`](/home/blu34/projects/dnd-agent/src/lib/game/types.ts:956)
- extend [`generatedWorldModuleSchema`](/home/blu34/projects/dnd-agent/src/lib/game/session-zero.ts:1008)
- ensure parsing and module resolution continue to work through [`parseWorldTemplate`](/home/blu34/projects/dnd-agent/src/lib/game/repository.ts:177) and [`resolveModuleWorld`](/home/blu34/projects/dnd-agent/src/lib/game/repository.ts:193)

### Runtime State

Progression should live in runtime state alongside current conditions.

Long-term shape:

```ts
type CampaignRuntimeState = {
  ...
  characterState: {
    conditions: string[];
    activeCompanions: string[];
    maxVitality?: number | null;
    progression?: {
      activePathIds?: string[];
      trackValues: Record<string, number | boolean | string>;
    };
  };
};
```

The important source of truth is raw track values. Prompt-facing summaries should be derived from those values, not treated as canonical stored state.

Implementation note: any v1 engine change must preserve existing `characterState` members, especially `activeCompanions` and `maxVitality`, when writing `nextState`.

### Prompt-Facing Summary

The engine should be able to derive a compact progression summary for prompt use:

```ts
type DerivedProgressionSummary = {
  tracks: Array<{
    id: string;
    label: string;
    value: number | boolean | string;
    summary: string;
  }>;
  activePaths?: Array<{
    id: string;
    label: string;
    summary: string;
  }>;
  worldStanding?: {
    effectiveTierId?: string | null;
    effectiveTierLabel?: string | null;
    relativeStanding: string;
  } | null;
};
```

This should be compact enough to fit into planning and narration without materially bloating prompt budgets.

For v1 authoring, modules should keep the number of exposed progression tracks intentionally small. The first implementation should favor a compact summary over exhaustive state dumping.

### Mutation Surface

Progression should have its own mutation rather than overloading `update_character_state`.

Long-term shape:

```ts
type MechanicsMutation =
  | ...
  | {
      type: "update_character_progression_track";
      trackId: string;
      mode: "set" | "add" | "subtract";
      value: number | boolean | string;
      reason: string;
      phase?: MutationPhase;
    };
```

Recommended conceptual split:

- `update_character_state` for temporary or status-like character state
- `update_character_progression_track` for persistent progression values

## World-Relative Scaling

This feature matters most when a campaign has a recognizable public power scale and a character may follow either the orthodox path or a deviant one.

Example pattern:

- world ladder: Kindled -> higher tiers -> godhood
- character progression path: abyssal assimilation
- tracks:
  - assimilation = 18
  - hunger = 6
  - stability = 4
  - concealment = 3
- derived standing:
  - effective tier: early Kindled
  - relative standing: stronger than ordinary laborers, nearing trained junior delvers

That same structure generalizes beyond hidden-power fantasies:

- political campaigns can compare influence to local elites
- divine campaigns can compare favor to priestly hierarchies
- criminal campaigns can compare notoriety to faction strata
- mutation campaigns can compare threat level to ordinary people or formal hunters

The important design principle is:

- **tracks are the core**
- **world-relative standing is optional but valuable**

## Prompt and Runtime Integration

### Runtime principle

Raw progression state belongs in runtime state, updated through the same projected-state pattern used for other runtime mutations.

That means this feature should fit the existing engine flow used around:

- [`engine.ts:5387`](/home/blu34/projects/dnd-agent/src/lib/game/engine.ts:5387)
- [`engine.ts:5877`](/home/blu34/projects/dnd-agent/src/lib/game/engine.ts:5877)
- [`engine.ts:6905`](/home/blu34/projects/dnd-agent/src/lib/game/engine.ts:6905)

### Prompt principle

Dynamic progression should not be treated as static character identity. It should be surfaced through prompt context.

That suggests the clean integration points are:

- [`SpatialPromptContext`](/home/blu34/projects/dnd-agent/src/lib/game/types.ts:1534)
- [`TurnRouterContext`](/home/blu34/projects/dnd-agent/src/lib/game/types.ts:1599)
- [`getTurnRouterContext`](/home/blu34/projects/dnd-agent/src/lib/game/repository.ts:6000)
- [`getPromptContext`](/home/blu34/projects/dnd-agent/src/lib/game/repository.ts:6087)

Then planning, narration, and suggested actions can inherit that state through:

- [`buildTurnUserPrompt`](/home/blu34/projects/dnd-agent/src/lib/ai/provider.ts:6047)
- [`buildResolvedTurnNarrationPrompt`](/home/blu34/projects/dnd-agent/src/lib/ai/provider.ts:6283)
- [`buildResolvedTurnSuggestedActionsPrompt`](/home/blu34/projects/dnd-agent/src/lib/ai/provider.ts:6373)

This is preferable to inflating the static character object with more pseudo-static data.

## Authorization Principle

Progression should not ride on unrelated router vectors.

Today, self-state changes are awkwardly gated through an unrelated lane in [`engine.ts:5387`](/home/blu34/projects/dnd-agent/src/lib/game/engine.ts:5387). That mismatch will matter even more once progression becomes first-class.

Long-term, progression should have a legitimate authorization lane, whether that is:

- a new self-directed vector
- a more general character-advancement rule
- or a cleaner router/mechanics contract for self-directed transformation and growth

This does not need to be fully solved in the first implementation slice, but the spec should assume progression deserves a real lane.

For v1, do not redesign router vectors. Add the new mutation and keep its authorization behavior aligned with the current self-state lane so the engine contract stays small. The important thing in v1 is separating the mutation type and state model, not solving router taxonomy in the same change.

## V1 Implementation Slice

This is the implementation boundary the first agent should build.

### V1 goal

Prove the core loop:

- progression persists in runtime state
- later turns can see it
- prompts can reason about it
- campaigns can express at least one compact world-relative interpretation

### V1 scope

Build only this:

1. Add `characterState.progression.trackValues` to runtime state.
2. Add module-owned progression track definitions as a new optional authored field.
3. Add one mutation: `update_character_progression_track`.
4. Support only numeric tracks in v1.
5. Support only `set`, `add`, and `subtract`.
6. Expose a compact progression summary in prompt context.
7. Optionally derive a single compact `relativeStanding` line from a primary track when the module provides enough authored guidance.

### V1 intentionally defers

Do not build these in the first slice:

- multiple concurrent progression paths with engine semantics
- visibility levels
- boolean, tier, or counter track kinds
- persisted derived summaries
- campaign-owned progression definitions in addition to module-owned ones
- full ladder/equivalency machinery across many tracks and paths
- large UI investments

### V1 recommended shape

Recommended v1 authored definitions:

```ts
type ProgressionTrackDefinition = {
  id: string;
  label: string;
  summary: string;
  min?: number;
  max?: number;
  defaultValue: number;
  worldStandingScale?: Array<{
    minValue: number;
    relativeStanding: string;
    effectiveTierLabel?: string | null;
  }>;
};
```

Recommended v1 authored container:

```ts
type ProgressionFramework = {
  tracks: ProgressionTrackDefinition[];
  primaryTrackId?: string | null;
};
```

This should be added as an optional `progressionFramework` field on `GeneratedWorldModule` in v1.

Recommended v1 runtime state:

```ts
type CampaignRuntimeState = {
  ...
  characterState: {
    conditions: string[];
    activeCompanions: string[];
    maxVitality?: number | null;
    progression?: {
      trackValues: Record<string, number>;
    };
  };
};
```

Recommended v1 mutation:

```ts
type MechanicsMutation =
  | ...
  | {
      type: "update_character_progression_track";
      trackId: string;
      mode: "set" | "add" | "subtract";
      value: number;
      reason: string;
      phase?: MutationPhase;
    };
```

### V1 integration points

- extend runtime-state schema normalization
- extend generated world-module schema parsing for `progressionFramework`
- update projected state application in engine
- skip direct DB-row mutation work just like other runtime-only state changes
- update state commit log schema to recognize `update_character_progression_track`
- extend router/prompt context with compact progression data
- surface that context to planning, narration, and suggestions

Concretely, the first implementation will likely need changes in:

- [`src/lib/game/types.ts`](/home/blu34/projects/dnd-agent/src/lib/game/types.ts)
- [`src/lib/game/session-zero.ts`](/home/blu34/projects/dnd-agent/src/lib/game/session-zero.ts)
- [`src/lib/game/json-contracts.ts`](/home/blu34/projects/dnd-agent/src/lib/game/json-contracts.ts)
- [`src/lib/game/engine.ts`](/home/blu34/projects/dnd-agent/src/lib/game/engine.ts)
- [`src/lib/game/repository.ts`](/home/blu34/projects/dnd-agent/src/lib/game/repository.ts)
- [`src/lib/ai/provider.ts`](/home/blu34/projects/dnd-agent/src/lib/ai/provider.ts)

### V1 success criteria

V1 is successful if:

- a module can define one or more progression tracks
- a turn can update a track through mechanics
- the updated track persists to later turns
- later prompts can reference that track coherently
- one campaign can express world-relative scaling from that state without bespoke engine logic
- the derivation of `relativeStanding` is deterministic from authored module data, not generated ad hoc by the model

## Post-V1 Expansion

After v1 is proven in play, the system can grow into the rest of the architecture:

- richer track kinds
- explicit progression paths
- canonical ladders
- multi-path reasoning
- more expressive world-relative derivation
- better UI exposure
- cleaner progression-specific router authorization

The important constraint is that those later additions should extend the v1 core, not force a rewrite.

## Test Plan

### V1 tests

Add targeted tests for:

- runtime schema normalization with empty and populated progression state
- valid numeric track updates
- invalid track id rejection
- invalid mode rejection
- min/max clamping or rejection behavior, whichever v1 adopts
- prompt-context generation including progression summary
- continuity across multiple turns where a track changes and later prompts still see it
- optional relative-standing output when a module provides authored scale metadata

### Future tests

Defer until later phases:

- multi-path interactions
- non-numeric track kinds
- full ladder equivalency across multiple tracks
- visibility-driven presentation differences

## Recommendation

Adopt this as a real campaign-playthrough feature with a strict staged rollout.

The long-term feature should remain:

- progression tracks as the core abstraction
- optional paths
- optional world ladders
- optional world-relative standing

But the first implementation should stay intentionally narrow:

- module-defined numeric progression tracks
- runtime persistence
- one progression mutation
- compact prompt exposure
- optional single-line world-relative interpretation

That is enough to prove the engine can support “power scaling of a unique character relative to the world” without overcommitting the first delivery.
