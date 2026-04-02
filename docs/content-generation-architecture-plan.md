# Content Generation Architecture Plan

This document is the implementation plan for moving the turn-generation stack away from giant static system prompts and toward a narrower, more enforceable architecture.

It is written for the actual product target:

- a large open-world text RPG
- strong continuity across locations, NPCs, factions, and time
- AI-authored story and atmosphere by default
- engine-owned authority over truth, legality, and persistent consequence

This is not a plan to make the world smaller or less ambitious. It is a plan to support that ambition without letting prompt size become the hidden rules engine.

## Why This Exists

The current turn loop is directionally correct:

- the engine loads authoritative state
- the model interprets player intent and proposes structured actions
- the engine validates and commits deterministic state
- narration happens after commit from committed outcomes

That core split is good.

The problem is that too much policy currently lives inside giant handwritten system prompts in `src/lib/ai/provider.ts`. Those prompts now carry:

- tool semantics
- legality rules
- target-presence rules
- spatial continuity rules
- custody rules
- check gating rules
- anti-hallucination rules
- style rules
- regression-specific repairs

That creates four scaling problems:

1. Prompt maintenance gets harder every week.
2. Behavioral fixes are too often expressed as more prose instead of stronger contracts.
3. Small logic changes can create subtle regressions across unrelated cases.
4. The model is still doing too much hidden policy interpretation for a game that promises long-term world consistency.

The answer is not "use a better model" and it is not "write an even bigger prompt." The answer is to keep reassigning authority from prompt text to structured state, executable rules, and narrow model tasks.

## Goal

Build a content-generation architecture where:

- the model is excellent at interpretation, selection, and prose
- the engine is authoritative about truth and legality
- prompt size grows sublinearly as features are added
- world consistency comes primarily from state contracts and retrieval, not from giant prompt reminders
- regressions are caught by targeted verifiers and evals, not only by adding more planner instructions

## Non-Goals

This plan does not aim to:

- remove AI from planning or narration
- collapse the open world into a smaller or more scripted experience
- replace freeform player input with rigid commands
- introduce deterministic local DM fallback logic as a primary play path
- solve everything by building a quest engine

## Design Principles

### 1. Engine authority must increase over time

Every rule that can be expressed as deterministic legality should be owned by code, not by planner prose.

Examples:

- whether a target is present
- whether a route is traversable
- whether an item is grounded
- whether a trade is actually finalized
- whether a mutation is compatible with current focus
- whether a change belongs in immediate or conditional phase

### 2. The model should solve smaller problems

The planner should not be asked to do all of the following at once:

- classify intent
- infer scope
- choose a mechanic lane
- decide whether a check matters
- remember every target rule
- remember every tool contract
- write a valid payload
- avoid old regressions

That is too much hidden burden for one pass.

### 3. Context should become more explicit, not broader

The model should receive more computed truth and fewer giant reminder paragraphs.

Good context:

- `sceneActors`
- `knownNearbyNpcs`
- `availableInteractionTargets`
- `blockedActions`
- `openDeals`
- `currentSceneAffordances`
- `mustVerifySurfaces`

Bad context:

- long prose explanations of what those things imply if the engine can compute it directly

### 4. Narration must remain downstream of committed truth

Narration quality matters, but the narrator should never be the source of truth. The current post-commit narration direction is correct and should be strengthened, not weakened.

### 5. Every recurring bug class should earn either:

- a deterministic engine rule
- a narrow verifier pass
- a targeted eval case

It should not automatically earn another permanent global prompt bullet.

## Current-State Diagnosis

### What is already strong

- Commit-first state authority in `src/lib/game/engine.ts`
- Post-commit narration from committed outcomes
- Structured tool use rather than raw prose planning
- Meaningful validation and correction loops
- Strong targeted tests around real regressions
- Reasonable separation between router context and prompt context

### What is currently weak

- Giant monolithic planner prompts
- Too much handwritten policy text in `provider.ts`
- Drift risk between engine semantics and prompt semantics
- Growing reliance on prompt reminders to avoid known failures
- Limited architectural separation between semantic interpretation and mutation selection
- Incomplete eval story for longitudinal quality trends
- Some fallback/guardrail behavior still depends on local heuristics instead of first-class state contracts

## Target Architecture

The target loop should look like this:

1. Build an authoritative turn context packet.
2. Ask the model for a compact semantic frame.
3. Compile or expand that frame into a candidate mechanics plan with only relevant policy modules attached.
4. Run narrow verifier passes on the candidate plan.
5. Validate and commit deterministic state in the engine.
6. Build post-commit narration context from the committed snapshot.
7. Ask a separate narrator for prose.
8. Ask a separate suggester for grounded next actions.

The key shift is this:

- the planner prompt stops being the entire rules engine
- context packets and verifier stages carry more of the consistency burden

## Proposed Components

### A. Policy Registry

Create a canonical registry for mutation and tool semantics.

Each action type should declare metadata such as:

- required grounding surfaces
- allowed target classes
- forbidden target classes
- whether offscreen use is allowed
- whether same-turn chaining is allowed
- whether the action can imply movement
- allowed phases
- related verifier rules
- human-readable planner guidance

This registry becomes the source for:

- generated planner guidance
- validation wiring
- targeted verifier selection
- future docs

It should replace large amounts of handwritten repeated prompt text.

### B. Prompt Policy Composer

Replace one giant static planner prompt with a composer that assembles only the policy slices needed for the current turn.

Inputs:

- turn mode
- authorized vectors
- whether a check is possible
- whether a scene focus is active
- whether the turn is local or macro
- whether trade/inventory/world-object semantics are in play
- whether the player is targeting nearby-but-offscreen named NPCs

Outputs:

- compact planner system prompt
- explicit machine-readable policy manifest for logging and debugging

Success condition:

Most turns should use a materially smaller policy surface than the current monolith.

### C. Semantic Frame Pass

Add a new narrow model pass before mechanics planning.

The semantic frame should answer questions like:

- What is the player's actual commitment level?
- Is this flavor, manifestation, knowledge, travel, social exchange, force, or maintenance?
- Is the target on-screen, nearby-offscreen, unresolved, or absent?
- Is success gating materially required?
- Is the player trying to create, inspect, transfer, persuade, search, reposition, or wait?
- What world surfaces are relevant?

This output should be compact and strongly typed.

The point is to separate interpretation from mechanical expansion.

### D. Candidate Plan Verifiers

After the planner produces a candidate mechanics payload, run cheap targeted verifiers on it.

These verifiers should be narrow and explicit, for example:

- target presence verifier
- scene focus continuity verifier
- custody and transfer verifier
- payment and trade closure verifier
- check gating verifier
- discovery grounding verifier
- movement implication verifier
- same-turn spawn/presence chaining verifier

The verifier can:

- accept
- reject with specific issues
- request a planner retry with machine-generated correction notes

This is much healthier than encoding every such case permanently into the top-level planner prompt.

### E. Affordance-Rich Context Packets

Upgrade prompt context from descriptive state to more explicit action affordances.

Examples of fields worth adding:

- `availableInteractionTargets`
- `availableNamedNpcInteractions`
- `availableLocalManifestations`
- `reachableSceneTransitions`
- `blockedTargetReasons`
- `openNegotiations`
- `unresolvedFollowUps`
- `sceneContinuityHints`
- `authoritativeTruthTiers`

Truth should be tiered explicitly:

- committed authoritative state
- fetched detail
- discovered information
- retrieved memory
- recent prose continuity only

This makes it easier for the model to reason safely without reading a law book.

### F. Tool Docs Generated From Code

Planner-facing descriptions for mutations and tools should be rendered from structured metadata rather than maintained manually in one large prompt string.

This reduces drift and makes new mechanics cheaper to add.

### G. Eval and Incident Corpus

Build a first-class eval corpus around real failure classes.

Minimum buckets:

- target substitution
- offscreen/presence drift
- stale-scene interaction
- fake trade completion
- fake payment closure
- invalid discovery grounding
- long-action pacing drift
- narrator contradiction after commit
- repeated suggested actions
- continuity loss across revisits

Every severe incident should produce:

- a minimal replay case
- a deterministic test if possible
- a verifier case if deterministic ownership is appropriate
- an eval example if model judgment is still involved

## Implementation Phases

## Phase 0: Baseline Measurement

Before major refactors, measure the current system.

### Deliverables

- Turn-generation timing breakdowns
- Retry counts by stage
- Clarification rate
- Validation rejection rate
- Narration fallback rate
- Suggested-action regeneration failure rate
- Prompt-size logging by stage
- Provider token usage logging if practical

### Acceptance Criteria

- We can quantify current planner prompt size, retry behavior, and failure distribution.
- We have a baseline to compare against after prompt decomposition.

## Phase 1: Policy Inventory and Extraction

Extract the current planner rules into a categorized policy inventory.

### Categories

- target legality
- state grounding
- movement/focus continuity
- social interaction semantics
- trade/custody semantics
- check gating
- discovery semantics
- narration-only style rules
- observe-mode restrictions

### Deliverables

- A policy inventory doc or source file
- Identification of which policies belong in:
  - engine validation
  - verifier passes
  - generated tool docs
  - narrator-only instructions
  - planner-only instructions

### Acceptance Criteria

- No current planner rule remains "uncategorized."
- We know which rules are real game law versus prompt ergonomics.

## Phase 2: Canonical Policy Registry

Implement a structured policy registry in code.

### Deliverables

- Registry types for tool/mutation semantics
- Per-mutation metadata for grounding, targets, phases, and anti-patterns
- Helpers to render compact planner guidance from registry entries

### Acceptance Criteria

- At least the highest-risk mutations are registry-backed:
  - `record_npc_interaction`
  - `record_local_interaction`
  - `set_player_scene_focus`
  - `set_scene_actor_presence`
  - `transfer_assets`
  - `discover_information`
  - `adjust_currency`
  - `spawn_*` mutations

## Phase 3: Dynamic Planner Prompt Composer

Replace the monolithic planner prompt with a composable builder.

### Deliverables

- Shared base planner instructions
- Conditional policy modules
- Generated tool guidance from registry metadata
- Logging of which modules were attached on each turn

### Constraints

- Do not regress current legality behavior while shrinking prompt surface area.
- Keep observe mode and player-input mode split cleanly.

### Acceptance Criteria

- Prompt size drops materially on ordinary local turns.
- Planner outputs remain schema-valid at current or better rates.

## Phase 4: Semantic Frame Pass

Insert a compact interpretation pass before mechanics planning.

### Proposed Frame Shape

- player commitment level
- semantic lane
- intended target class
- intended outcome class
- whether success gating matters
- expected time posture
- required world surfaces
- unresolved referent policy

### Deliverables

- Frame schema
- Frame prompt
- Frame parser and retry loop
- Planner prompt updated to consume the frame rather than rediscover it

### Acceptance Criteria

- The planner prompt gets simpler because commitment/scope/semantic-lane reasoning is no longer buried inside it.
- Regressions caused by overcommitting weak player intent decrease.

## Phase 5: Candidate Verifier Layer

Add post-planner narrow verification before engine validation/commit.

### Scope

Start with high-value verifiers only.

- presence verifier
- focus continuity verifier
- custody verifier
- discovery grounding verifier
- trade closure verifier

### Behavior

Verifier output should be machine-usable:

- pass
- fail with structured reasons
- suggested correction note payload

### Acceptance Criteria

- Known high-risk planner mistakes can be rejected before commit without adding new global planner prose.
- Incident fixes increasingly land in verifier rules instead of prompt growth.

## Phase 6: Affordance-Oriented Context Refactor

Upgrade router and prompt context to include more explicit action affordances.

### Deliverables

- richer computed context packet fields
- explicit truth-tier labeling
- explicit blocked-action reasons
- explicit same-turn continuity hints
- explicit unresolved-follow-up surfaces

### Acceptance Criteria

- The planner can rely less on descriptive inference.
- Several current prompt instructions become unnecessary because the context now states the answer directly.

## Phase 7: Narrator and Suggester Isolation

Keep the planner, narrator, and suggester separate and intentionally small.

### Deliverables

- planner instructions that contain little or no prose-style guidance
- narrator instructions focused on committed truth and style
- suggester instructions focused on grounded immediate follow-through
- separate evals per stage

### Acceptance Criteria

- Planner changes rarely require narrator prompt edits.
- Suggested actions quality can improve independently of planner changes.

## Phase 8: Eval Program and Release Gates

Turn quality measurement into a standing development requirement.

### Deliverables

- replayable incident corpus
- eval script entrypoint for turn-planning regressions
- eval script entrypoint for narration consistency
- scorecards per model/provider version
- release gate thresholds for critical failure classes

### Acceptance Criteria

- Architecture changes can be judged by measured regression rates, not just vibes.
- Prompt size reduction is tracked alongside quality outcomes.

## Recommended Execution Order

1. Phase 0: Baseline measurement
2. Phase 1: Policy inventory
3. Phase 2: Canonical policy registry
4. Phase 3: Dynamic prompt composer
5. Phase 5: Candidate verifier layer
6. Phase 4: Semantic frame pass
7. Phase 6: Affordance-oriented context refactor
8. Phase 7: Narrator and suggester isolation
9. Phase 8: Eval program and release gates

This order is deliberate.

- Measurement comes first so improvement is observable.
- Policy extraction comes before prompt decomposition so we do not lose implicit rules.
- Verifiers can pay off early even before the full semantic-frame split lands.
- Context refactor should come after we know what the planner and verifiers actually need.

## Risks

### 1. Over-engineering before baseline measurement

If we refactor prompts without measuring current failure classes, we may shrink the prompt and regress quality blindly.

### 2. Moving too much too quickly into deterministic code

Some problems are genuinely interpretive and should remain model-owned. The goal is not to turn the game into a brittle parser.

### 3. Two-layer complexity during transition

For a while the system may have:

- old prompt rules
- new registry-driven guidance
- partial verifier coverage

That transition must be staged carefully or it will be harder to debug than the current monolith.

### 4. Context packet inflation

Richer affordances are good only if they stay compact and high-signal. This plan must not replace giant prompts with giant context dumps.

## Success Metrics

The architecture move is successful if, over time, we observe:

- smaller average planner prompt size
- fewer planner retries
- lower rate of prompt-only hotfixes for logic regressions
- stable or improved turn quality
- fewer target-presence and continuity bugs
- fewer contradictory narrations after commit
- lower suggested-action staleness/repetition
- faster incident recovery because failures map cleanly to registry, verifier, context, or narrator layers

## Concrete First Slice

If implementation starts immediately, the first thin slice should be:

1. Instrument prompt size and retry metrics.
2. Build the policy inventory from the current planner prompts.
3. Create registry metadata for the focus/presence/social interaction family.
4. Add a first dynamic policy composer for those rules only.
5. Add a first verifier for target presence and focus continuity.
6. Compare prompt size and regression rate against baseline.

This slice is small enough to ship incrementally and directly targets the class of regressions that currently produce prompt bloat.

## Final Position

The project should treat giant system prompts as transitional scaffolding, not the mature architecture.

For a sprawling open-world RPG, consistency will come from:

- authoritative state
- explicit affordances
- smaller model jobs
- verifier layers
- incident-driven evals

not from an ever-growing planner constitution in `provider.ts`.
