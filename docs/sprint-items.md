# Sprint Items

This is the living high-level roadmap for the next major product and architecture pushes.

Purpose:
- keep the sequencing clear
- show what can run in parallel
- define when an initiative is done enough to move on
- provide stable anchors for future detailed specs with acceptance criteria and implementation plans

This document is intentionally high level. Detailed feature specs should be created as separate docs and linked back here once each item is ready for implementation.

## Status Legend

- `Not Started`: no implementation work has begun
- `In Progress`: active implementation or active spec work is underway
- `Parallel`: can proceed without waiting on the current primary track
- `Blocked`: should not start until listed dependency is complete
- `Done`: exit criteria are satisfied

## Recommended Order

1. Recursive world generation and descent
2. World builder AI foundations on top of descent
3. Selective content-generation architecture hardening where it directly supports 1 and 2

Rationale:
- recursive descent is the clearest current product gap
- world builder becomes much more stable once world, region, and settlement layers have a real generation pipeline
- the full content-generation architecture plan is valuable, but should be pulled in surgically instead of becoming the main branch of work right now

---

## 1. Recursive World Generation and Descent

Status:
- `Not Started`

Priority:
- `Primary`

Can Run In Parallel With:
- item 3.1 prompt-context cleanup
- item 3.4 eval and regression coverage

Blocked By:
- nothing

Depends On:
- existing world-scale and module launch flow

Why This Comes First:
- the product already knows about world-scale modules, but they are not yet fully launchable without descent/materialization
- this unlocks the next real layer of playable content instead of only improving internal architecture

### Goal

Allow a campaign or module created at world scale to descend into:
- region-level generated content
- settlement/local area generated content
- playable launchable content with stable references between layers

### Checklist

- [ ] Define the first supported descent chain:
  world -> region -> settlement/local play space
- [ ] Decide and document the authoritative handoff artifacts between each layer
- [ ] Define the descendant artifact persistence model for region and settlement/local outputs
- [ ] Define the orchestration entrypoint/service that owns multi-step descent
- [ ] Add generation contracts for region outputs
- [ ] Add generation contracts for settlement/local outputs
- [ ] Define how parent-layer facts constrain child-layer generation
- [ ] Define stable IDs and reference rules across descent
- [ ] Define versioning rules for regenerated descendants
- [ ] Implement world -> region materialization
- [ ] Implement region -> settlement/local materialization
- [ ] Define failure recovery and partial-generation cleanup behavior
- [ ] Ensure descended modules are launchable through the existing campaign creation flow
- [ ] Add repository support for reading descended hierarchy cleanly
- [ ] Add tests that prove descended content remains coherent and playable
- [ ] Add at least one end-to-end happy path:
  world module -> region -> settlement -> launch campaign

### Done When

- a world-scale module can be selected and actually turned into a playable campaign through descent
- each descent step produces stable structured artifacts, not ad hoc blobs
- descended child layers preserve important parent facts and constraints
- the launch flow no longer dead-ends on world-scale content
- there is at least one automated end-to-end test proving the descent chain works

### Suggested Sub-Splits

#### 1.1 World -> Region Descent

Status:
- `Not Started`

Can Run In Parallel With:
- 1.2 schema drafting for region -> settlement

Checklist
- [ ] Define region generation schema
- [ ] Define what world-level facts are passed down
- [ ] Generate and persist region artifacts
- [ ] Define region persistence/versioning rules
- [ ] Validate region outputs are launchable to the next step

Done When
- a world-scale artifact can deterministically produce region-scoped generated artifacts with stable references

#### 1.2 Region -> Settlement / Local Descent

Status:
- `Not Started`

Can Run In Parallel With:
- 1.1 once shared contracts are stable

Checklist
- [ ] Define settlement/local generation schema
- [ ] Define what region-level facts are passed down
- [ ] Generate and persist settlement/local artifacts
- [ ] Generate entry points compatible with the current playable loop
- [ ] Generate traversable route/location topology compatible with current traversal systems
- [ ] Ensure descended data includes the location/route surfaces required by the current engine and snapshot
- [ ] Test at least one descended settlement/local area with the current movement/travel flow
- [ ] Ensure descended local content fits the current playable game loop

Done When
- a region artifact can produce settlement/local play spaces that the engine can actually launch into play

#### 1.3 Launchability and UX Wiring

Status:
- `Not Started`

Blocked By:
- minimum viable outputs from 1.1 and 1.2

Checklist
- [ ] Update repository launchability queries for descended targets
- [ ] Update `campaigns/create` flow for descended launch targets
- [ ] Update `custom-entry` and `opening-draft` APIs if they assume directly launchable source content
- [ ] Update campaign creation UX to support descended launch targets
- [ ] Update campaign creation app for descent target selection and status visibility
- [ ] Expose descent progress/errors clearly in the creation flow
- [ ] Prevent users from selecting world content that cannot complete descent
- [ ] Define launch bundle assembly from descended outputs
- [ ] Add operator/debug visibility into which descent stage failed

Done When
- the UI/API flow supports selecting high-level content and arriving at a playable launch target without manual intervention

#### 1.4 Regeneration and Invalidation Rules

Status:
- `Not Started`

Can Run In Parallel With:
- 1.1 and 1.2 once persistence shape is understood

Checklist
- [ ] Define when descendants are replaced vs patched
- [ ] Define which IDs stay stable across regeneration
- [ ] Define how regenerated descendants invalidate old launch targets
- [ ] Define whether old descendants are archived, discarded, or overwritten
- [ ] Define how builder edits or spec fixes trigger re-materialization safely

Done When
- regeneration behavior is predictable enough that builder work and launch flows do not depend on hidden assumptions

---

## 2. World Builder AI

Status:
- `Blocked`

Priority:
- `Secondary`

Can Run In Parallel With:
- selective architecture work from item 3

Blocked By:
- item 1 must reach at least a stable first descent chain

Why It Waits:
- a builder without a stable hierarchical generation pipeline will create assets and workflows we are likely to redo
- descent gives the builder real target layers to edit or generate against

### Goal

Create an AI-assisted world builder that can help author and refine:
- regional structure
- settlements/locales
- descended launchable content

First Supported Scope:
- region and settlement shaping only
- operates on already-materialized descendants
- no broad world-level freeform builder in the first pass

### Checklist

- [ ] Define builder inputs and editable artifacts
- [ ] Define builder outputs and approval flow
- [ ] Define how builder changes re-trigger descent/regeneration
- [ ] Define when builder edits preserve IDs vs create replacements
- [ ] Add first builder-facing API surface
- [ ] Add first builder UI surface
- [ ] Add at least one narrow builder workflow that is faster than manual prompting
- [ ] Add tests covering edit -> regenerate -> launch continuity

### Done When

- a user can intentionally shape generated world content through a supported UI/API workflow
- builder output feeds back into the actual generation pipeline instead of becoming sidecar content
- at least one builder-assisted flow reliably improves speed or quality over manual intervention

### Suggested First Cut

- [ ] Keep MVP constrained to region and settlement shaping after the first descent chain exists
- [ ] Defer broad fully-freeform world-authoring ambitions until descent and regeneration contracts settle

---

## 3. Selective Content-Generation Architecture Hardening

Status:
- `Parallel`

Priority:
- `Support Track`

Can Run In Parallel With:
- item 1
- item 2 once started

Blocked By:
- nothing, but should stay scoped to immediate product leverage

Why This Is Not First
- the architecture plan is directionally correct, but executing it wholesale now would slow down a more urgent product unlock
- we should pull in the pieces that reduce prompt sprawl and regressions where the descent and builder work actually touch them

### Goal

Reduce prompt bloat and improve reliability in the specific areas needed for:
- world generation
- hierarchical descent
- world builder workflows
- traversal/discovery continuity

### Checklist

#### 3.1 Prompt Context and Policy Cleanup

Status:
- `Not Started`

Can Run In Parallel With:
- item 1

Checklist
- [ ] Identify the highest-risk monolithic prompt sections used by world/content generation
- [ ] Extract reusable policy/context builders where they reduce duplication
- [ ] Shrink prompt surface area for world generation and related planning flows
- [ ] Add logging/debug visibility into which policy slices were attached

Done When
- world/descent-related prompts are meaningfully smaller and easier to reason about without losing capability

#### 3.2 Generation Contracts and Structured Validation

Status:
- `Not Started`

Can Run In Parallel With:
- item 1

Critical To:
- item 1 completion

Checklist
- [ ] Tighten Zod/schema contracts for world, region, and settlement generation
- [ ] Add structured validation for parent -> child descent consistency
- [ ] Add descendant launchability validation before content is exposed as playable
- [ ] Add regeneration consistency validation so re-materialization does not silently break references
- [ ] Emit machine-readable failure reasons for retry loops and debugging
- [ ] Ensure invalid outputs fail clearly with actionable diagnostics
- [ ] Remove avoidable heuristic cleanup in favor of model/router decisions or schema validation

Done When
- generation failures are mostly contract/validation issues with clear debugging paths, not silent prompt drift

#### 3.3 Targeted Verifiers for High-Risk Flows

Status:
- `Not Started`

Blocked By:
- some implementation surface from item 1 or 2

Checklist
- [ ] Identify the highest-value verifier passes for descent or builder edits
- [ ] Add narrow verifier stages only where recurring failures justify them
- [ ] Avoid broad speculative verifier layers that do not pay for themselves

Done When
- the most common expensive failure modes are caught by narrow verifiers instead of growing global prompts

#### 3.4 Evals and Regression Coverage

Status:
- `Not Started`

Can Run In Parallel With:
- item 1
- item 2
- 3.1 through 3.3

Checklist
- [ ] Create a canonical world-scale fixture set
- [ ] Create a canonical descent-chain fixture set
- [ ] Capture representative world -> region -> settlement scenarios as eval fixtures
- [ ] Add regression snapshots for launchability and parent-child continuity
- [ ] Add regression tests for launchability and continuity
- [ ] Add golden-path samples for builder-assisted edits once item 2 begins
- [ ] Track recurring generation failure classes in a reusable way

Done When
- new work on world gen and builder flows has concrete regression coverage instead of relying mostly on memory and manual spot checks

---

## 4. Cross-Cutting Implementation Rules

These are not standalone roadmap items, but they should govern the work above.

### Checklist

- [ ] Keep campaign and character instance backward-compatibility work minimal unless explicitly required
- [ ] Prefer schema and model contracts over regex or heuristic parsing
- [ ] Keep gameplay/story generation AI-authored by default rather than adding deterministic DM fallback logic
- [ ] Add stage-by-stage diagnostics for multi-step generation and descent failures
- [ ] Persist enough descent status metadata to explain which stage failed
- [ ] Make prompt, validation, persistence, and launch-preparation failure boundaries easy to inspect
- [ ] Create detailed spec docs per feature before large implementation begins
- [ ] Link each detailed spec back into this document once created

### Done When

- major work items consistently reference a spec, acceptance criteria, and test coverage before they are considered complete

---

## Immediate Next Step

Primary recommendation:
- [ ] Write the first detailed spec for item 1.1:
  world -> region descent

After that:
- [ ] Write the companion spec for item 1.2:
  region -> settlement/local descent
- [ ] Identify the smallest item 3 pull-ins needed to keep those specs clean and implementable

## Linked Specs

Add links here as we create them.

- [x] [World -> Region Descent Spec](/home/blu34/projects/dnd-agent/docs/sprint-items/world-to-region-descent-spec.md)
- [ ] Region -> Settlement Descent Spec
- [ ] World Builder AI MVP Spec
- [ ] Prompt/Validation Hardening Spec
- [x] [Recursive Descent Spec Seed](/home/blu34/projects/dnd-agent/docs/sprint-items/recursive-descent-spec-seed.md)

---

## Initial Spec Seed: Recursive Descent

The recursive descent seed now lives in its own doc:

- [Recursive Descent Spec Seed](/home/blu34/projects/dnd-agent/docs/sprint-items/recursive-descent-spec-seed.md)

What it currently covers:
- canonical multiscale topology direction
- containment vs traversal
- travel-play as first-class generated content
- synchronous generation vs async enrichment boundaries
- prompt-context expectations during traversal
- persistence and regeneration questions the next detailed spec must answer

Exit criteria for this seed:
- [ ] We agree on one canonical multiscale topology
- [ ] We agree that travel-play is first-class generated content, not an afterthought
- [ ] We agree on the sync generation vs async enrichment boundary
- [ ] We agree that ordinary local buildings/POIs are not default graph nodes
- [ ] We agree the next standalone detailed spec should be `world -> region descent` with travel fabric included
