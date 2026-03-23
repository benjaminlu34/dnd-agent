# Finish the Open-World Simulation Rehaul

## Summary

Complete the remaining unchecked work in `open-world-simulation-plan.md` by extending the current graph-first runtime instead of replacing it. The implementation should build on the existing `triageTurn` -> `validateTurnCommand` -> `commitResolvedTurn` loop, the existing world tables (`NpcRoutine`, `FactionMove`, `WorldEvent`), and the existing citation validation. The missing pieces are: three new action tools, a real simulation tick, invertible simulation writes, a stronger world-fidelity audit, and thinner prompt context with bounded deep fetches.

Implementation order:
1. Turn/runtime contract expansion
2. Simulation core and rollback
3. Daily scheduling and event generation
4. Context slimming, deep-fetch tools, and fidelity audit
5. Campaign-start social hydration and runtime locals
6. Performance hardening and tests

## Key Changes

### 1. Expand the runtime contract to support `combat`, `trade`, and `rest`
- Add three action tools to the AI/tool schema and `TurnActionToolCall` union: `execute_combat`, `execute_trade`, `execute_rest`.
- Add minimal persistent mechanics required to make them real:
  - `NPC.state` with `active | wounded | incapacitated | dead`
  - `NPC.threatLevel` as the engine-facing combat difficulty scalar
  - `CharacterCommodityStack` for player-owned trade goods, keyed by `characterInstanceId + commodityId`
- Keep rest engine-owned:
  - `light` rest = 360 minutes, recover to at least 50% max HP if lower
  - `full` rest = 480 minutes, recover to max HP
- Keep combat v1 intentionally simple:
  - target must be a present NPC in non-`dead` state
  - DC derives from `NPC.threatLevel`
  - `attack` can set `wounded` then `dead`, `subdue` can set `incapacitated`, `assassinate` is only valid from non-combat/exploration scenes and fails closed otherwise
  - faction-linked targets queue follow-up `FactionMove` or `WorldEvent` reactions
- Keep trade fully authoritative:
  - price derives from `MarketPrice.modifier * Commodity.baseValue`
  - buy requires stock and gold
  - sell requires player-owned stack quantity
  - trades mutate gold, stock, and player commodity stacks only

### 2. Add typed simulation structures and execute them inside turn commit
- Introduce a typed `NpcRoutineCondition` union and typed `SimulationPayload` union in the game types layer; stop treating `triggerCondition` and `payload` as ad hoc JSON in engine code.
- Add a condition evaluator that returns `false` for unknown condition types and never throws the tick forward.
- Refactor `commitResolvedTurn` into a single transaction that:
  - applies player action effects
  - advances `CampaignRuntimeState.globalTime`
  - runs `runSimulationTick(tx, previousTime, newTime, inverses)`
  - stores rollback metadata on the turn record
- Store rollback metadata in `Turn.resultJson.rollback`, including `simulationInverses`, processed event IDs, cancelled move IDs, and created record IDs.
- Implement tick passes in this order:
  - NPC routine pass
  - due world-event pass
  - faction-reaction pass
  - economy/restock and information-expiry pass
- Enforce `MAX_CASCADE_DEPTH = 3` on spawned reactions and events.
- Add a non-fatal stability report when one tick causes too many state changes.

### 3. Schedule the world instead of precomputing it
- Trigger daily JIT scheduling whenever a committed turn crosses a day boundary.
- Generate only the next in-world day of `WorldEvent` and `FactionMove` records, informed by current faction state, location control, and visible player impact.
- If a single turn skips multiple days, generate and simulate each day sequentially, capped at 7 days.
- Validate generated records against the typed routine/payload schema before writing them.
- Default to destructive simplicity: no module-version migration work beyond the already-present `schemaVersion` and `isLocked` fields.

### 4. Replace fat prompt context with a thin base context plus fetch tools
- Slim `getPromptContext` to a base context containing:
  - current location summary
  - adjacent routes
  - present NPC names/ids only
  - recent local event summaries
  - recent memory ledger
  - discovered information summaries/ids
  - inventory summary
  - global time, time of day, day count
- Add repository-backed fetch tools:
  - `fetch_npc_detail`
  - `fetch_market_prices`
  - `fetch_faction_intel`
  - `fetch_information_detail`
  - `fetch_information_connections`
  - `fetch_relationship_history`
- Enforce a hard budget of 3 pre-action fetches per turn.
- Treat budget overflow as a base-context design problem; log it and fail the turn with clarification rather than silently allowing unbounded fetches.

### 5. Add campaign-start social hydration and on-demand local population
- Keep module-generation NPC output intentionally sparse. The module should carry anchor NPCs, not the full day-to-day population of every settlement.
- During campaign creation, hydrate the selected entry point and nearby hops with additional talkable locals tied to the starting social surface:
  - innkeepers, quartermasters, vendors, tavern staff, clerks, patrols, guides, repair workers, brokers, and other ordinary contacts
- Treat these campaign-stage locals as the first "thickening" pass for the world:
  - world module = backbone
  - campaign generation = starting-region cast
  - runtime = scene-by-scene extras
- At runtime, support lightweight on-demand locals when the player asks for a plausible ordinary contact not already in the persistent cast.
- Only promote an on-demand local into a persistent NPC record if they become mechanically important, recur across turns, hold inventory, affect faction state, or become part of the player's remembered social graph.
- This split should preserve two goals at once:
  - world generation stays compact, stable, and cheaper to regenerate
  - inhabited locations still feel socially alive once a campaign actually begins

### 6. Expand world-fidelity validation from citation membership to factual consistency
- Keep `citedEntities`, but strengthen validation by mode:
  - exploration, conversation, observation, trade, rest: run world-fidelity audit
  - combat and freeform: keep existing narration checks plus world-fidelity checks for named facts
- Add blocking/warning issues for:
  - hallucinated entity
  - uncited mechanical entity
  - invented price
  - invented fact
  - temporal inconsistency
  - spatial inconsistency
- Use fetched context plus base context as the allowed fact set for that turn.
- Make commodity citations mandatory once `execute_trade` ships; remove the current “ignored because trading is deferred” warning path.

### 7. Performance hardening
- Add the planned indexes that support NPC location lookup, event scheduling, faction-move scheduling, market lookups, information lookups, and routine time queries.
- Stop building the full campaign snapshot for every turn when only prompt context is needed; split snapshot loading from prompt-context loading.
- Benchmark base context assembly against a large seeded world and target `<150ms` before shipping the thin-context path.

## Public Interfaces / Types

- `TurnActionToolCall` adds `execute_combat`, `execute_trade`, `execute_rest`.
- `CampaignRuntimeState` keeps `globalTime`; no new time source is introduced.
- `NPC` adds `state` and `threatLevel`.
- New `CharacterCommodityStack` model becomes the authoritative storage for traded commodities.
- `NpcRoutine.triggerCondition` and `WorldEvent.payload` / `FactionMove.payload` are represented in TypeScript as discriminated unions and validated before execution.
- `Turn.resultJson` gains a `rollback` object with `simulationInverses`.

## Test Plan

- Validation tests for all new tool calls:
  - invalid combat target
  - invalid trade quantity / insufficient gold / insufficient stock
  - invalid rest duration overrides
  - time-bound enforcement for all three tools
- Engine transaction tests:
  - player action plus simulation tick commit together
  - rollback reverses simulation writes in reverse order
  - cascade-depth cap prevents infinite reactions
- Simulation tests:
  - highest-priority routine wins for one NPC
  - due events process once
  - cancelled moves do not execute
  - multi-day skip generates and resolves days sequentially
- World-fidelity tests:
  - invented commodity/price blocks
  - uncited NPC/location/faction blocks
  - fetched-detail narration is accepted
- Performance tests:
  - thin base context under target latency on a large seeded world
  - fetch-tool budget enforcement after 3 calls

## Assumptions And Defaults

- Existing campaign/module data is disposable; no compatibility or migration-preservation work is included.
- Combat is intentionally lightweight v1 and does not introduce a full tactical battle subsystem.
- Traded goods are stored separately from generic inventory items to avoid overloading item-instance semantics.
- Rollback metadata lives on `Turn.resultJson` rather than in a new table.
- Campaign-start social hydration should add density around the entry area without forcing the world module itself to pre-author every ordinary local contact.
- Phase 7 character-depth work is out of scope for this pass because it is not part of the unchecked “next” items and is not required to complete the runtime/simulation rehaul.
