# Recursive Descent Spec Seed

This is the first-pass spec backbone for the recursive descent initiative. It is intentionally early, but concrete enough to guide the first standalone implementation spec.

## Problem Statement

We want world-scale campaign modules to feel like living places rather than static launch stubs.

That requires more than:
- a world object
- a list of regions
- a list of settlements

It also requires generated travel-play between destinations, so journeys can support:
- discoveries
- interruptions
- shelter/refuge decisions
- route-side secrets
- reactive diversions
- meaningful play before arrival

The system must therefore support:
- hierarchical descent from world -> region -> settlement/local
- a travel fabric that makes journeys playable
- enough up-front generation that players are not blocked mid-play waiting for major content generation

## Core Product Requirement

The player should not hit a normal travel flow and then wait on fresh generation to keep playing.

Implication:
- recursive descent cannot be purely on-demand during play
- but we also should not fully deep-generate every possible local detail in the whole world before the campaign starts

## Model Invariants

These are the hard commitments for the seed.

- there is one canonical identity/connectivity authority
- there are 3 descent layers:
  world, region, settlement/local
- travel-play is cross-cutting content, not a 4th hierarchy layer
- containment is not traversal authority by default
- ordinary local buildings/POIs are not default graph nodes
- journey-class travel must be explicitly supported as playable mode, not only compressed narration
- sync generation is governed by a preload horizon, not whole-world equal readiness

## Glossary

- `semantic key`: stable module-level identity used to refer to descendants across materialization/regeneration
- `materialized descendant`: a generated artifact bundle instantiated from a semantic source
- `canonical identity/connectivity authority`: the source of truth for semantic identity, containment relationships, reachability skeleton, and discoverability references
- `region bundle`: descended artifact package for a region
- `settlement shell`: minimum immediately playable settlement artifact
- `corridor pack`: bounded travel-play artifact package attached to a travel corridor
- `manifest`: lightweight not-yet-fully-enriched descendant representation
- `launchability`: whether an artifact is sufficiently materialized to support intended play entry
- `preload horizon`: deterministic set of content that must be fully playable without waiting

## Proposed Direction

Use:
- one canonical identity/connectivity authority
- hierarchical containment metadata
- descended artifact bundles for region, settlement, and travel content
- scale-aware projections for prompt context, UI, and travel decisions

Do not use:
- separate competing authoritative graphs per scale
- one homogeneous storage shape for every world, region, settlement, and travel artifact

The important distinction is:
- one source of truth for identity, containment, reachability, and discoverability
- multiple descended artifact bundles that make each scale playable without forcing every concern into one graph/table abstraction

## Ownership Boundaries

The first detailed spec should preserve these ownership boundaries:

- world spine owns regions and inter-region travel skeletons
- region bundles own intra-region travel, corridor packs, hidden regional destinations, and regional discoverability hooks
- settlement shells own arrival surfaces, ordinary social anchors, egress points, and local leads needed for immediate play

World and region descent should not both own the same corridor family.
Inter-region travel belongs to world-scale output.
Intra-region travel belongs to region-scale output.

## Canonical World Model

The recursive descent model should distinguish:

1. Containment
- world contains regions
- regions contain settlements and regional sublocations
- settlements contain local places and meaningful sublocations

2. Traversal
- travel happens on explicit route edges and gateway transitions
- containment is not pathfinding authority by default

3. Projection
- the engine shows different travel surfaces depending on active play scale
- those surfaces are projections over one canonical identity/connectivity layer

4. Materialization
- descended artifacts are produced as bounded bundles
- region bundles, settlement shells, and corridor packs do not need to share one storage shape
- they must still resolve back to canonical semantic identity/connectivity

5. Discoverability
- canonical authority owns discoverability references at the semantic layer
- descended bundles materialize discoverability hooks, hidden destinations, and route-scoped discovery content for play
- hidden destinations must have canonical semantic identities before region bundles materialize them for play
- runtime reveal state must bind through semantic keys/materialized descendants without inventing a separate disconnected identity system

## Node and Edge Philosophy

Nodes should exist only when they carry real gameplay/travel meaning.

Good node candidates:
- regions
- settlements
- major landmarks
- passes
- shrines
- ruins
- camps
- harbors
- route-side shelters
- promoted local destinations with meaningful travel semantics

Bad default node candidates:
- ordinary shops
- ordinary buildings
- routine rooms
- flavor-only POIs

Rule:
- local places should stay as scene focus, leads, or minor candidates unless moving to them carries meaningful time, access gating, risk, isolation, or durable state separation

## Travel Must Be First-Class Generated Content

Recursive descent is not only place generation.
It is also journey-space generation.

For each generated region, the system should produce:
- regional route corridors
- travel-critical waypoints
- route-side discoveries
- hidden detours
- refuge/shelter options
- route-specific hazards/pressures
- secrets and side opportunities discoverable during travel

Design rule:
- every journey-class corridor should support meaningful interruption play

This should not be universal.
Short or routine transfers should not be forced to behave like mini-adventures.

### Corridor Classes

The first detailed spec should define corridor taxonomy using:
- base classes
- modifiers/tags

Suggested base classes:
- trivial transfer
- routine route
- journey route
- stranding-risk route

Suggested modifiers/tags:
- hidden
- gated
- seasonal
- hostile-control
- hazardous

Only `journey route` and `stranding-risk route` corridors should be required to carry a full interruption envelope.

### Corridor Pack Expectations

Each corridor should materialize as a bounded corridor pack rather than an unbounded pile of side content.

The first detailed spec should define:
- hard caps on interruption candidates
- hard caps on shelters/refuges
- hard caps on hidden discoveries
- what is represented as graph-connected destinations vs corridor-attached artifacts

Minimum corridor pack fields should include:
- corridor semantic key/reference
- base class
- modifiers/tags
- interruption candidate summaries
- refuge/shelter summaries when applicable
- hidden/detour opportunity summaries when applicable
- active pressures/hazards
- next anchor/fallback anchor references

Minimum interruption envelope expectations for journey-class corridors:
- at least one refuge/shelter or fallback option when stranding is plausible
- at least one potential discovery, detour, or interruption opportunity
- enough authored/generated context to support meaningful route-scene play before arrival

## Generation Layers

Keep 3 descent layers:
- world
- region
- settlement/local

Travel-play is not a 4th hierarchy layer.
It is a required cross-cutting output of world and region descent.

### Layer 1: World Spine

Generate:
- world premise
- major regions
- macro travel entities and corridors
- world-scale pressures
- high-level faction and conflict distribution

Output should be enough to define:
- what major places exist
- how the world is broadly connected
- what regional generation must inherit

### Layer 2: Region Fabric

Generate per region:
- settlements
- major landmarks
- regional travel corridors
- corridor packs
- route-side anchors
- hidden or conditional destinations
- regional pressures and travel texture

Output should be enough to define:
- where the player can go inside the region
- what makes travel through the region interesting
- what settlement generation must inherit

The first detailed spec should define a concrete region bundle contract, including:
- region semantic key
- inherited world references
- settlement shell manifests
- corridor pack manifests
- hidden destination manifests
- discoverability hooks
- launchability criteria
- cardinality caps

### Layer 3: Settlement / Local Shells

Generate per settlement:
- settlement identity
- playable entry points
- meaningful districts or subareas only where justified
- important local anchors
- nearby leads and promotable minor locations
- immediate local route semantics needed for play

Output should be enough to:
- launch local play
- support nearby movement
- provide hooks into deeper future enrichment

### Settlement Shell Launchability Contract

A settlement shell is not just a teaser.
It must be immediately playable.
It does not own corridor topology; it exposes arrival/egress surfaces that reference region-owned travel structure.

The first detailed spec should define a minimum launchability contract that likely includes:
- an arrival surface
- 2-3 ordinary social anchors
- egress routes
- at least one rest/refit surface if the settlement is civilized
- immediate local tension or pressure
- minor-location candidates/leads

Without this, “shell” risks meaning “empty place that still needs async hydration before it feels alive.”

## Synchronous Generation vs Async Enrichment

### Preload Horizon

The sync boundary should be defined by a preload horizon, not by making the whole world equally ready.

The preload horizon should be expressed in terms of:
- likely travel reach from the launch point
- region hops
- journey distance/time
- early-game expected exploration envelope

Product rule:
- no normal play stall inside the preload horizon

For the first implementation, the preload horizon should be deterministic rather than heuristic.
The detailed spec should choose one concrete policy, for example:
- launch region fully materialized
- all settlements and corridors in the launch region needed for ordinary play fully materialized
- directly adjacent inter-region travel exits materialized
- immediate entry settlements/arrival shells in directly adjacent regions materialized

The seed-level requirement is:
- preload scope must be explicit enough that two engineers would preload the same content

### Must exist synchronously by campaign creation

- world spine
- launch region bundle
- launch settlement/local shell
- enough neighboring region/settlement outputs inside the preload horizon to keep ordinary travel unblocked
- all travel-critical topology inside the preload horizon
- enough interruption-envelope content inside the preload horizon that the first several journeys are playable immediately
- manifests for content outside the preload horizon

Behavior outside the preload horizon:
- distant content may remain manifest/capsule level at campaign creation
- intentional travel beyond the preload horizon must still remain valid play
- the engine may prewarm distant descendants during long-form journey play, but should not expose an arrival that will dead-end into missing required play surfaces

### Can be enriched later

- deep local internals for distant settlements
- extra NPC density
- low-priority side content
- richer local secrets
- secondary sublocations that are not required for launchability or near-term travel play
- corridor enrichment beyond the preload horizon
- distant region expansion from manifest into richer descended artifacts

Rule:
- async enrichment may improve depth
- async enrichment must not be required for ordinary travel continuity

## Travel and Scale Transitions

Movement should feel like explicit engine-owned scale transitions, not traversing one giant flat menu.

### Region-to-region travel

Player experience:
- macro destinations
- route conditions
- hazards
- long-distance journey pressure

Engine context should include:
- current region
- reachable macro destinations
- known major routes
- travel pressures
- active journey state
- tightly bounded destination summary when relevant

### Intra-region travel

Player experience:
- settlements
- landmarks
- regional routes
- hidden side destinations
- route-side opportunities

Engine context should include:
- current route corridor
- nearby known anchors
- relevant hidden/discoverable opportunities
- current pressures and detours
- refuge options if the journey is interrupted

### Settlement/local play

Player experience:
- current place
- scene focus
- local leads
- promoted nearby destinations

Engine context should include:
- current local area
- meaningful sublocations only
- nearby NPC and object context
- leads and promotion candidates

## Journey Play Mode

Meaningful route-scene play is not just a retrieval tweak.
It requires an explicit mode.

The first detailed spec should define a `journey_play` mode with:
- planner expectations for travel-scene decisions
- narrator expectations for in-journey play rather than compressed arrival-only narration
- a route-scoped prompt packet
- mutation/tool expectations compatible with active journey state
- explicit entry conditions
- explicit exit/compression conditions
- engine ownership of active journey state transitions

## Prompt Context Principle

Prompt context should be:
- scale-specific
- relevance-scoped
- authoritative

It should not be based on pure adjacency alone.

The active context packet should also consider:
- discovered information
- route visibility
- faction pressure
- active hazards
- intended destination
- current journey state
- hidden but already-known routes

Rule:
- retrieve the smallest authoritative packet that preserves decision quality

For `journey_play`, the packet should be tightly budgeted.
The first detailed spec should likely cap it to something like:
- journey header
- current corridor
- next anchor/refuge
- 1-2 interruption candidates
- destination summary
- relevant revealed facts
- active pressure

## Persistence Model Expectations

The spec should eventually define separate handling for:
- canonical module artifacts
- descended child artifacts
- live campaign runtime state

At minimum, recursive descent needs clear answers for:
- where descended region artifacts live
- where settlement shells live
- where corridor packs live
- how stable IDs are assigned and preserved
- how regeneration invalidates or replaces descendants
- how launchability is determined from descended outputs

### Semantic Keys and Materialization Records

The first detailed spec must define:
- module-level semantic keys
- materialized descendant records
- campaign-scoped instance ids
- how semantic keys map to materialized descendants across regeneration

Stable references should be promised at the semantic-key layer first, not by assuming materialized ids remain stable forever.

Runtime state attachment must also be defined:
- what campaign/runtime state binds to semantic keys
- what binds to materialized descendant records
- what happens to attached state when descendants are regenerated or replaced

## Regeneration Expectations

Recursive descent must support re-materialization safely.

The eventual spec should define:
- when descendants are replaced vs patched
- what IDs remain stable across regeneration
- how stale launch targets are invalidated
- whether old descendants are archived, overwritten, or discarded

This is required before broad World Builder AI work starts.

## Acceptance Criteria For The First Detailed Spec

The first standalone recursive descent spec should answer:
- what the canonical identity/connectivity layer looks like
- what descended artifact bundles exist and how they relate to canonical identity/connectivity
- what is containment vs traversal
- what is generated at world, region, and settlement layers
- what corridor classes exist and what each class must generate
- what travel-play content is mandatory for journey-class corridors
- what must be generated synchronously inside the preload horizon
- what may be enriched asynchronously later
- what the settlement shell launchability contract is
- what `journey_play` mode requires
- what prompt context the model gets during world, region, and local traversal
- what persistence model stores descended outputs
- what semantic-key/materialization rules govern regeneration and launchability

## Non-Goals For The First Detailed Spec

The first standalone `world -> region` spec should not try to fully solve:
- full settlement interior generation
- full world-builder editing workflows
- every future prompt-architecture refactor
- comprehensive regeneration policy for every downstream feature
- complete distant-world enrichment beyond what the preload horizon requires

## Exit Criteria For This Spec Seed

- [ ] We agree on one canonical identity/connectivity authority plus descended artifact bundles
- [ ] We agree that travel-play is first-class generated content, not an afterthought
- [ ] We agree on corridor classes instead of one universal interruption rule
- [ ] We agree on the preload-horizon sync generation boundary
- [ ] We agree that ordinary local buildings/POIs are not default graph nodes
- [ ] We agree that `journey_play` needs explicit mode support
- [ ] We agree the next standalone detailed spec should be `world -> region descent` with travel fabric included
