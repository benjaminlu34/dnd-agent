# Combat Vitality Spec

## Summary

The current combat pipeline tracks player durability numerically but tracks NPC durability categorically. The player has `health`; NPCs have `state` (`active`, `wounded`, `incapacitated`, `dead`) plus `threatLevel`. This works for short, simple fights, but it will likely drift in longer or multi-actor combat because the planner must remember cumulative damage narratively instead of manipulating a grounded vitality value.

This document proposes a lightweight vitality system for NPCs that preserves the current story-first style while giving the engine a durable mechanical anchor for multi-turn combat resolution.

## Current State

### What exists today

- Player durability is numeric.
- NPC durability is categorical.
- Combat progression against NPCs is expressed through mutations like `set_npc_state`.
- `threatLevel` exists, but it is static pressure/importance, not a damage track.

### Why this is brittle

- The planner has to decide when enough harm has accrued to flip an NPC from `active` to `wounded` or from `wounded` to `dead`.
- In multi-round combat, that cumulative reasoning lives mostly in model context instead of grounded state.
- The problem gets worse with:
  - multiple simultaneous enemies
  - bosses with uneven pacing
  - scenes with interruptions, movement, or split focus
  - retries or narration salvage after partial failures

### Likely failure modes

- weak enemies become accidentally unkillable
- bosses die too early
- the same enemy “forgets” prior wounds
- the planner overuses `set_npc_state` as a direct storytelling shortcut
- narration and mechanics can diverge on how hurt an NPC really is

## Design Goals

- Ground cumulative NPC damage in state instead of prompt memory.
- Keep the system lighter than full D&D-style HP math.
- Avoid forcing the narration model to manage arithmetic.
- Preserve the current `NpcState` categories for UI and narration.
- Make combat resolution deterministic enough for long fights without overcomplicating minor scuffles.

## Non-Goals

- Full tactical combat simulation
- exact initiative systems
- weapon-specific rules expansion
- AC/damage-dice fidelity
- rebuilding the entire violence router

## Recommended Model

### Add NPC vitality as a small numeric track

Add a lightweight integer field to NPC state, for example:

- `vitalityCurrent`
- `vitalityMax`

This should be intentionally small, such as 1-6 or 1-8, not full RPG HP.

### Keep `NpcState` as the player-facing category

`state` should remain, but become a derived or engine-managed interpretation of vitality:

- `active`: vitality above the wound threshold
- `wounded`: vitality reduced but above incapacitation
- `incapacitated`: vitality at 0 but not necessarily dead
- `dead`: explicitly killed / finished / fatal outcome committed

This preserves the current story-facing vocabulary while grounding it in a persistent mechanic.

### Introduce a dedicated damage mutation

Instead of making the planner decide state transitions directly in most combat turns, introduce a bounded mutation such as:

- `apply_npc_harm`

Suggested fields:

- `npcId`
- `harm`
- `reason`
- `phase`
- optional `intent`: `injure` | `subdue` | `kill`

The engine then:

1. subtracts vitality
2. derives or updates `NpcState`
3. records the resulting threshold crossing cleanly

This keeps the planner focused on intent and consequence rather than bookkeeping.

## Why Not Just Keep `set_npc_state`

`set_npc_state` is still useful for:

- explicit executions
- deterministic aftermath
- scripted state changes
- non-damage incapacity

But it should not remain the default way to express ordinary cumulative combat harm. If it does, the planner is still deciding durability by feel.

Recommended rule:

- ordinary attacks and exchanges use `apply_npc_harm`
- explicit exceptional outcomes may use `set_npc_state`

## Vitality Sizing

The system does not need full HP. It needs consistent pacing.

Recommended baseline:

- low-threat NPC: `vitalityMax = 1-2`
- ordinary trained NPC: `vitalityMax = 3`
- elite NPC: `vitalityMax = 4-5`
- boss / monster anchor: `vitalityMax = 6+`

`threatLevel` can seed the initial vitality if desired, but the two should not be treated as the same concept.

Example mapping:

- `threatLevel 1` -> vitality 1-2
- `threatLevel 2` -> vitality 2-3
- `threatLevel 3` -> vitality 3-4
- `threatLevel 4+` -> vitality 5+

This can stay heuristic and internal.

## Routing and Planner Changes

### Router

No major router redesign is required. Violence turns can keep activating `violence`, but combat-capable violent actions should bias toward a damage-capable mechanic path.

### Planner prompt

Planner guidance should change from:

- “set the NPC to wounded/incapacitated/dead when appropriate”

to:

- “for ordinary combat harm, use `apply_npc_harm`; let the engine carry cumulative vitality and resulting state”

### Checks

Checks can still gate whether harm applies or how much applies, but the final cumulative effect should be grounded in vitality, not in one-off categorical judgment.

## Engine Behavior

When `apply_npc_harm` commits:

1. validate target NPC is grounded and present/engageable
2. decrement vitality
3. clamp at zero
4. derive resulting `NpcState`
5. write a state commit log entry that includes:
   - old vitality
   - new vitality
   - old state
   - new state
   - harm amount

This gives narration and memory a clean mechanical truth source.

## Narration Implications

Narration should continue to speak in story terms, not numeric terms.

Good:

- “He folds around the blow and comes back slower.”
- “Her stance is still dangerous, but the wound is beginning to tell.”

Bad:

- “He is now at 1 vitality.”

The narrator should use:

- `NpcState`
- committed harm
- visible combat consequences

and never expose the underlying vitality number unless a future feature explicitly wants that.

## Memory and Causality

Combat memory should prefer threshold crossings and major injuries over every single chip of harm.

Useful memory triggers:

- first time an NPC becomes wounded
- incapacitation
- death
- major boss threshold crossing

This keeps memory density sane while preserving meaningful combat beats.

## Migration Strategy

Because local data is disposable in this repo, migration complexity can stay low.

Recommended approach:

1. add vitality fields to NPC persistence/state
2. seed existing NPCs from `threatLevel`
3. keep `set_npc_state` working during transition
4. add `apply_npc_harm`
5. update violence planner prompt to prefer it
6. add tests for multi-round consistency

## Test Plan

Add targeted tests for:

- repeated harm across 3-5 rounds on one NPC
- two NPCs taking different cumulative damage
- boss pacing over longer combat
- subdual vs lethal intent
- mixed turns where movement and harm both occur
- narration staying consistent after threshold crossings
- retries/fallbacks not losing prior damage state

## Open Questions

- Should vitality live directly on `NPC`, runtime state, or both?
- Should `wounded` be derived automatically or still planner-controlled in edge cases?
- Do companions use the same vitality model as hostile NPCs?
- Does subdual require a separate final state, or is `incapacitated` enough?

## Recommendation

Do not ship this before live combat testing proves the problem is real, but treat it as the default next architecture if combat drift shows up. The smallest robust solution is:

- lightweight numeric NPC vitality
- a dedicated harm mutation
- `NpcState` retained as the narrative/category layer

That gives the engine a true cumulative combat memory without dragging the project into heavyweight tactical rules.
