# World -> Region Descent Spec

This document defines the first detailed implementation spec for recursive descent.

Its job is to turn a world-scale module into cleanly materialized region outputs that:
- preserve canonical identity and connectivity
- support world-scale and inter-region travel planning
- provide enough region fabric for meaningful travel-play
- create the right inputs for a later `region -> settlement` descent

This spec is intentionally bounded.
It does not attempt to solve full settlement materialization in the same pass.

## Summary

The system should descend a world-scale module into:
- a canonical world identity/connectivity layer
- region manifests for every region in the world
- materialized region bundles inside a deterministic preload horizon
- world-owned inter-region travel outputs

The resulting architecture should let a later `region -> settlement` pass consume region bundles without having to reinterpret the world spine from scratch.

## Scope

This spec covers:
- world-scale semantic identity and connectivity
- region manifest and region bundle contracts
- inter-region and intra-region travel ownership boundaries
- preload-horizon materialization rules
- regional travel-play generation requirements
- semantic-key and regeneration rules needed before implementation

This spec does not cover:
- full settlement shell materialization
- local/urban route topology
- full opening-scene launchability for world modules
- broad World Builder AI workflows
- complete downstream regeneration policy for settlement/local descendants

## Current Constraint

Today, world-scale modules are recognized as requiring descent before launch.
This spec defines the first half of that missing path.

After this spec is implemented:
- world modules should be able to materialize into region outputs
- but direct player launch may still remain blocked until `region -> settlement` is implemented

That is acceptable.
The goal of this spec is to create the clean foundation the next descent stage can rely on.

## Additional Constraints Before Implementation

### 1. Transactional preload materialization

The preload-horizon descent pipeline must behave as one strict materialization transaction.

Rule:
- if preload descent fails partway through, the entire preload materialization must roll back

Example:
- if the launch region materializes successfully but the second adjacent preload region fails, the orchestrator must not leave the campaign with a partially instantiated regional graph

Reason:
- partial preload materialization would corrupt downstream assumptions about launchability, descendant completeness, and later settlement descent

Implementation consequence:
- generation may occur in staged memory or temporary records first
- but committing descended runtime rows for the preload horizon must be atomic at the final persistence boundary

### 2. Non-playable post-descent campaign state

After this `world -> region` phase completes, the campaign must enter an explicit non-playable intermediate state until settlement descent is finished.

Rule:
- the engine and UI must not treat a region-descended-only campaign as ready for normal player runtime

Recommended status examples:
- `awaiting_settlement_descent`
- `descent_paused`

Reason:
- region bundles are structurally valuable, but they are not yet sufficient for ordinary player launch
- without an explicit state, the current engine or campaign load flow may attempt to enter unplayable content

## Grounding In Current Architecture

Today the architecture already has two relevant truth layers:

- canonical authored module data in `AdventureModule`, including `openWorldGenerationArtifactsJson`
- instantiated campaign runtime state in `Campaign`, `LocationNode`, `LocationEdge`, and related runtime tables

This spec assumes:
- the module artifact remains the canonical authored source
- descended region outputs are materialized into campaign runtime rows during campaign creation
- runtime rows must therefore carry enough semantic identity to survive later regeneration without heuristic matching

For first implementation, we should prefer mapping these concepts onto the existing runtime schema rather than inventing a parallel region-bundle persistence system immediately.

## Architectural Decisions

### 1. Canonical authority vs playable artifacts

There is one canonical identity/connectivity authority.

It owns:
- semantic keys
- containment relationships
- reachability skeleton
- discoverability references
- inter-region connectivity skeleton

It does not force every descended artifact into one storage shape.

Playable descended outputs are separate bounded artifacts:
- region manifests
- region bundles
- settlement manifests
- world travel bundles for inter-region corridors
- region corridor packs for intra-region journeys

### 2. Three descent layers only

The hierarchy is:
- world
- region
- settlement/local

Travel-play is not a fourth hierarchy layer.
It is cross-cutting generated content that appears in:
- world outputs for inter-region travel
- region outputs for intra-region travel

### 3. Ownership boundaries

Ownership must remain strict.

World spine owns:
- region semantic identities
- inter-region travel skeletons
- world-scale pressures
- world-owned inter-region travel bundles

Region bundles own:
- settlement manifests within the region
- regional landmarks and hidden destinations
- intra-region travel corridors
- corridor packs for intra-region travel
- regional discoverability hooks

Settlement shells will later own:
- arrival surfaces
- immediate local anchors
- local leads and promotable minor destinations

Settlement shells do not own regional corridor topology.
They reference region-owned egress and arrival structure.

### 4. Hidden destinations and discoverability

Hidden regional destinations must have canonical semantic identities before any region bundle materializes them.

Canonical authority owns:
- semantic identity
- containment
- discoverability references

Region bundles materialize:
- hidden destination manifests
- discoverability hooks usable during play
- route/corridor-local discovery context

This keeps reveal state stable across regeneration.

### 5. Region descent must be clean input for later settlement descent

`region -> settlement` should not need to:
- reinterpret the full world spine
- invent new semantic identities for settlements
- infer region travel ownership
- guess launchability prerequisites

This spec must therefore produce explicit settlement manifests and region bundle metadata that the next descent stage can consume directly.

### 6. Campaign status must reflect descent stage

Campaign lifecycle must distinguish:
- pre-descent world module selection
- region-descended but not settlement-ready campaigns
- fully launchable campaigns

This spec only reaches the second state.

## Model Invariants

- semantic identity is stable at the module level
- materialized descendants may be replaced without changing semantic keys
- containment is not traversal authority by default
- ordinary local buildings/POIs are not default graph nodes
- inter-region travel and intra-region travel are owned by different layers
- world modules are not considered fully player-launchable from this spec alone
- no ordinary player travel inside the preload horizon should dead-end on missing required region artifacts

## Canonical Data Model

This spec does not lock final Prisma model names, but it does lock the conceptual primitives.

### Canonical semantic primitives

- `WorldSemantic`
- `RegionSemantic`
- `SettlementSemantic`
- `RegionalDestinationSemantic`
- `InterRegionCorridorSemantic`
- `IntraRegionCorridorSemantic`

Each semantic primitive must have:
- stable semantic key
- parent semantic key where applicable
- canonical scale
- canonical role/type
- discoverability reference data where applicable

### Descended artifact primitives

- `RegionManifest`
- `RegionBundle`
- `SettlementManifest`
- `WorldTravelBundle`
- `RegionCorridorPack`

Each descended artifact must carry:
- source semantic key(s)
- materialization record id
- status
- version/generation metadata
- launchability metadata relevant to its scale

## Recommended Schema Mapping For First Implementation

These mappings are intentionally pragmatic for the current codebase.

### Required additions now

Add to `LocationNode`:
- `semanticKey String`
- `materializationLevel String`
- `descentDataJson Json?`

Add to `LocationEdge`:
- `semanticKey String`
- `materializationLevel String`
- `corridorClass String?`
- `modifiers String[]`
- `travelBundleJson Json?`

Why:
- `semanticKey` bridges module semantics to campaign-instantiated descendants
- `materializationLevel` distinguishes manifest/bundle/shell-style runtime rows
- `descentDataJson` gives manifest rows a place to store uninstantiated child references and preload metadata
- `corridorClass`, `modifiers`, and `travelBundleJson` give runtime edges enough structure for world/region travel ownership and later `journey_play`

### Defer broad additions for now

Do not require `semanticKey` / `materializationLevel` on `NPC` and `Information` in this first `world -> region` pass unless implementation proves they are instantiated here.

Reason:
- this spec materializes regional geography and travel fabric first
- broad semantic-key rollout to all generated entity tables is better handled when `region -> settlement` or later local hydration actually starts instantiating those entities through descent

That said, later descents will likely want semantic-key support on:
- `NPC`
- `Information`
- possibly other generated entity tables

### Conceptual mapping to current runtime tables

For v1:
- `RegionManifest` maps to a `LocationNode` with `type = "region"` and `materializationLevel = "manifest"`
- `RegionBundle` maps to that same semantic region upgraded to `materializationLevel = "bundle"`
- `SettlementManifest` maps to child `LocationNode` rows with `type = "settlement"` and `materializationLevel = "manifest"`
- intra-region travel routes map to `LocationEdge` rows owned by the materialized region bundle
- inter-region routes map to world-owned `LocationEdge` rows and travel-bundle payloads

Important:
- `AdventureModule` remains the canonical authored source
- campaign runtime rows are materialized descendants, not the canonical source itself
- later regeneration updates rows by `semanticKey`, not by deleting and re-guessing identities

## Region Output Contracts

### RegionManifest

Every world region must produce a `RegionManifest`.

Minimum fields:
- `regionSemanticKey`
- inherited world references
- region title/identity summary
- preload eligibility metadata
- settlement manifest index
- hidden destination manifest index
- intra-region corridor index
- materialization status

Purpose:
- lightweight world-wide representation
- safe to generate for all regions during world descent
- sufficient to decide which regions must be materialized into full bundles

Recommended first-implementation storage:
- `LocationNode(type = "region", materializationLevel = "manifest")`
- `descentDataJson` carries settlement keys, hidden-destination indexes, preload metadata, and downstream materialization hints

### RegionBundle

A `RegionBundle` is the materialized playable regional artifact.

Minimum fields:
- `regionSemanticKey`
- inherited world references and world pressures
- settlement manifests for the region
- regional destination manifests
- intra-region corridor descriptors
- corridor pack manifests
- regional discoverability hooks
- preload-horizon status
- region launchability metadata for downstream descent
- generation/version metadata

Purpose:
- owned input for later `region -> settlement`
- regional travel-planning surface
- source of intra-region journey play

Recommended first-implementation storage:
- same semantic region row upgraded from `manifest` to `bundle`
- child `LocationNode` rows for settlement manifests and regional destinations
- child/owned `LocationEdge` rows for intra-region travel structure

### SettlementManifest

This spec does not materialize settlement shells yet, but it must create settlement manifests that later descent can consume directly.

Minimum fields:
- `settlementSemanticKey`
- parent `regionSemanticKey`
- settlement identity summary
- settlement role/type
- arrival/egress references into region-owned travel structure
- downstream shell prerequisites
- preload relevance metadata

Purpose:
- reserve semantic identity
- let region bundles expose settlement structure without inventing settlement-local play prematurely

Recommended first-implementation storage:
- child `LocationNode(type = "settlement", materializationLevel = "manifest")`

## Travel Output Contracts

### Inter-region travel

Inter-region travel is world-owned.

This spec must produce:
- canonical inter-region corridor semantics
- world travel bundles for inter-region journey routes that need playable travel treatment

World-owned travel bundles should include:
- corridor semantic reference
- origin/destination region semantic keys
- corridor class and modifiers
- macro journey pressures
- bounded interruption candidates when the corridor is journey-class or stranding-risk
- fallback anchor references when applicable

Recommended first-implementation storage:
- `LocationEdge` rows for inter-region corridors
- `corridorClass`, `modifiers`, and `travelBundleJson` for world-owned journey support

### Intra-region travel

Intra-region travel is region-owned.

This spec must produce:
- canonical intra-region corridor semantics
- bounded `RegionCorridorPack`s for corridor routes inside a region bundle

Recommended first-implementation storage:
- `LocationEdge` rows attached to materialized regional descendants
- `travelBundleJson` for interruption-envelope and route-scene support

## Corridor Taxonomy

Corridors must use:
- one base class
- zero or more modifiers

### Base classes

- `trivial_transfer`
- `routine_route`
- `journey_route`
- `stranding_risk_route`

### Modifiers

- `hidden`
- `gated`
- `seasonal`
- `hostile_control`
- `hazardous`

Only `journey_route` and `stranding_risk_route` require a full interruption envelope.

### RegionCorridorPack minimum fields

- `corridorSemanticKey`
- base class
- modifiers
- current/default pressure summary
- interruption candidate summaries
- refuge/shelter summaries when applicable
- hidden/detour opportunity summaries when applicable
- next anchor/fallback anchor references

### Travel-play requirement

Not every corridor must be adventurous.

Rules:
- `trivial_transfer` should usually remain compressed
- `routine_route` may compress unless active pressure or discovery changes that
- `journey_route` must support meaningful route-scene play
- `stranding_risk_route` must support fallback/refuge logic and interruption play

## Preload Horizon

The preload horizon defines what must be fully usable without waiting.

For this spec, preload must be deterministic.
The later implementation may optimize it, but the contract must be clear.

### Seed policy for first implementation

Synchronously materialize:
- the launch region bundle
- all intra-region corridor packs needed for ordinary travel inside the launch region
- all settlement manifests in the launch region
- directly adjacent inter-region exits from the launch region
- immediate entry region manifests for directly adjacent regions
- world travel bundles for inter-region routes likely to be used first

Outside the preload horizon:
- regions may remain manifest-only
- inter-region travel may remain semantic-only until prewarmed

Product rule:
- no ordinary player path inside the preload horizon should arrive at missing required region-scale content

### Behavior beyond the preload horizon

Intentional travel beyond the preload horizon is still valid play.

Rules:
- the engine may prewarm distant descendants during longer-form travel
- the engine must not expose an arrival that will dead-end into absent required region artifacts
- if deeper descent is not ready, the system must continue journey play or defer arrival cleanly rather than fail silently

## Journey Play Mode

This spec assumes an explicit `journey_play` mode exists or will be added.

`journey_play` is required for:
- `journey_route`
- `stranding_risk_route`
- any route whose interruption content is materially relevant

The next runtime implementation should define:
- mode entry conditions
- mode exit/compression conditions
- route-scoped prompt packet
- narration rules for in-journey play
- mutation/tool contract while active journey state exists

### Journey packet expectations

Keep the packet tight.

Recommended maximum shape:
- journey header
- current corridor
- next anchor/refuge
- 1-2 interruption candidates
- destination summary
- relevant revealed facts
- active pressure

## Persistence and Regeneration

### Semantic keys

All regions, settlements, corridors, and hidden destinations created by this descent must have stable semantic keys.

Semantic keys are the stability contract.
Materialized record ids are not.

### Materialization records

Every `RegionBundle`, `SettlementManifest`, and travel bundle/pack must have materialization metadata so regeneration can:
- replace artifacts
- invalidate stale descendants
- preserve semantic references

### Runtime state attachment

The eventual implementation must define:
- what runtime state binds to semantic keys
- what runtime state binds to materialized records
- what happens when a materialized descendant is replaced during regeneration

This must be answered before broad regen-heavy workflows like World Builder editing.

## Launchability Semantics

This spec uses two launchability notions.

### Region launchability

A region is launchable for downstream descent when:
- the region bundle is materialized
- required settlement manifests exist
- required corridor descriptors/packs exist
- discoverability hooks and hidden destination manifests are structurally valid

This does not mean a player can start there yet.

### Player launchability

Player-launchability requires later settlement descent.
That remains out of scope for this spec.

### Campaign status requirement

Successful completion of this spec must not mark the campaign as fully playable.

Instead, campaign state must clearly indicate:
- region descent succeeded
- settlement descent is still required
- the normal runtime/adventure UI should not attempt to enter player play yet

## Generation Pipeline

### Step 1: Validate world-scale module

Validate the source world module has:
- region semantics
- inter-region connectivity skeleton
- world-scale pressures
- enough data to derive preload-horizon regions

### Step 2: Reserve canonical semantic keys

Reserve or derive semantic keys for:
- regions
- settlements
- regional hidden destinations
- inter-region corridors
- intra-region corridors

### Step 3: Create world-scale canonical authority records

Persist or stage:
- region semantic identities
- containment links
- inter-region corridor semantics
- discoverability references

### Step 4: Produce RegionManifest for every region

All regions must get manifests, even if they will not all get bundles immediately.

In the first implementation this means:
- insert region `LocationNode` manifest rows for every region
- attach `descentDataJson` for settlement indexes, hidden destination indexes, and preload metadata

### Step 5: Compute preload horizon

Apply deterministic preload policy from this spec.

### Step 6: Materialize RegionBundle for preload-horizon regions

For each selected region:
- materialize settlement manifests
- materialize regional destinations
- materialize intra-region corridors
- materialize corridor packs
- attach generation metadata and launchability metadata

In the first implementation this means:
- upgrade the region row to `materializationLevel = "bundle"`
- insert child settlement manifest rows
- insert hidden/minor regional destination rows as needed
- insert intra-region `LocationEdge` rows with corridor metadata and `travelBundleJson`

### Step 7: Materialize world travel bundles where required

For inter-region corridors in or touching the preload horizon:
- materialize world-owned travel bundles when the corridor class requires playable journey support

In the first implementation this means:
- create inter-region `LocationEdge` rows during campaign launch
- populate `corridorClass`, `modifiers`, and `travelBundleJson`

### Step 8: Persist status and invalidation metadata

Persist enough metadata to know:
- which regions are manifest-only
- which are bundled
- which descendants came from which generation pass
- which future descents are safe to run

This step should be owned by a dedicated orchestration service, for example:
- `WorldDescentOrchestrator`

That service should own:
- world-spine reading
- region manifest insertion
- preload-horizon selection
- preload region bundle generation
- descendant instantiation into runtime tables
- failure cleanup / partial-state handling

### Step 9: Set campaign descent status

On successful completion of this phase:
- persist an explicit campaign status indicating region descent is complete but settlement descent is still pending

On failure:
- do not leave any partial preload descendant state committed
- do not advance campaign status into a misleading partially-ready state

The orchestrator must only advance campaign descent status after the preload materialization transaction commits successfully.

## Transaction and Rollback Rules

The preload-horizon materialization phase is all-or-nothing.

Rules:
- staging/generation work may happen before commit
- final insertion/update of preload descendant runtime rows must commit atomically
- if any required preload region fails validation, generation, or persistence, the orchestrator must roll back the entire preload commit
- no partially bundled preload horizon may remain attached to the campaign

Allowed partiality:
- regions outside the preload horizon may remain manifest-only by design

Disallowed partiality:
- some preload-horizon regions bundled while others failed
- campaign status advanced despite incomplete preload materialization
- launchability metadata indicating readiness when settlement descent has not run

## Acceptance Criteria

- [ ] A world-scale module can descend into `RegionManifest` for every region.
- [ ] Preload-horizon regions materialize into `RegionBundle`s without requiring settlement-shell generation.
- [ ] Preload-horizon materialization commits atomically or rolls back completely.
- [ ] Every region bundle contains settlement manifests, corridor descriptors, hidden destination manifests, and discoverability hooks.
- [ ] Inter-region travel ownership is world-owned and intra-region travel ownership is region-owned.
- [ ] `journey_route` and `stranding_risk_route` corridors have bounded travel-play outputs.
- [ ] No ordinary player path inside the preload horizon can dead-end on missing required region-scale content.
- [ ] Semantic keys remain stable across regeneration even if materialized descendant records are replaced.
- [ ] Successful completion leaves the campaign in an explicit region-descended but not player-launchable status.
- [ ] The output contract is clean enough that a later `region -> settlement` spec can consume region bundles directly.

## Non-Goals

- full settlement shell implementation
- full local district/building generation
- complete opening-scene launch resolution
- complete distant-world enrichment
- full prompt-architecture rewrite

## Follow-On Spec Requirements

The next `region -> settlement` spec should be able to assume:
- region semantic keys already exist
- settlement manifests already exist
- region-owned travel structure already exists
- preload-horizon logic already identifies which settlements must be materialized first
- hidden destinations already have semantic identity before local play materializes them

## Minimal Downstream Contract For Future Region -> Settlement Descent

We should not fully spec `region -> settlement` yet.
That detailed spec should wait until `world -> region` is implemented and validated against real outputs.

However, this spec must still lock the minimum handoff contract so implementation does not paint the next stage into a corner.

### Required handoff outputs

Each materialized `RegionBundle` must provide enough structured output for later settlement descent to consume directly.

At minimum:
- `regionSemanticKey`
- settlement manifests with stable `settlementSemanticKey`
- arrival/egress references from settlement manifests into region-owned travel structure
- preload relevance metadata for each settlement
- hidden regional destination manifests that may later become settlement-adjacent or local destinations
- region-owned discoverability hooks that settlement descent must preserve rather than reinvent

### SettlementManifest minimum downstream contract

Even before settlement shells are implemented, every `SettlementManifest` produced by `world -> region` must include enough information for later hydration.

Minimum required fields:
- `settlementSemanticKey`
- `parentRegionSemanticKey`
- settlement role/type
- settlement identity summary
- arrival references
- egress references
- downstream shell prerequisites
- preload priority / materialization priority metadata

### Launchability handoff

This spec must leave campaign/runtime state in a form where settlement descent can continue deterministically.

That means:
- the campaign is explicitly marked as region-descended but not player-launchable
- settlement descent can identify which settlement(s) must materialize next
- no settlement-local assumptions are encoded only in prose or prompt text

### What remains intentionally unspecified for now

The later `region -> settlement` spec should decide, based on real `RegionBundle` outputs:
- exact settlement shell schema
- local node/topology rules
- local discoverability materialization details
- local NPC/information hydration shape
- exact prompt budgets for settlement generation

## Open Decisions To Resolve Early In The Next Implementation Pass

- exact canonical primitive shapes and storage models
- exact deterministic preload-horizon policy
- exact world travel bundle contract for inter-region journey routes
- exact runtime state attachment rules during regeneration
