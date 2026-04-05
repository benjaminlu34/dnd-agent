# Gated World Discovery Roadmap

## Status

The foundational discovery and route-gating layer already exists.

Implemented foundations:
- compact authoritative world spine
- `locationKind` and `discoveryState` on locations
- route `visibility` and `accessRequirementText`
- runtime known-route filtering for hidden routes
- in-transit travel state
- player-facing route/access copy in the adventure UI

This document now tracks only the work that is still unimplemented.

## Remaining Goal

Build the second discovery layer that makes the world feel denser and more unevenly explorable without bloating the authoritative spine:

- local minor places should exist around spine nodes before they become full graph destinations
- information should explicitly reveal places and routes
- minor places should be promotable into real graph nodes when play proves they matter
- discovery UX should distinguish rumors, nearby leads, revealed routes, and promoted destinations

## Remaining Implementation Order

1. Phase 1: Add promotable minor-location candidates to world generation
2. Phase 2: Let information explicitly reveal places and unlock routes
3. Phase 3: Replace remaining over-rigid discoverability validation with world-level rules
4. Phase 4: Make runtime promotion of minor locations real
5. Phase 5: Improve player-facing discovery UX
6. Phase 6: Deepen access requirements only if the simpler system proves insufficient

## Phase 1: Promotable Minor-Location Candidates

### Objective

Allow the world to feel locally dense without inflating the world spine.

We already have `locationKind` / `discoveryState`, but world generation does not yet emit a true candidate layer of nearby minor places that can later be promoted.

### Required Changes

- Add a lightweight generated minor-location candidate artifact layer around spine locations.
- Keep candidates bounded per parent spine location.
- Store enough data to support later promotion without treating every candidate as a real travel node immediately.

Minimum candidate fields:
- `id`
- `parentLocationId`
- `name`
- `type`
- `summary`
- `discoveryState: "ambient" | "rumored" | "revealed" | "promoted"`
- `suggestedAccessRequirement: string | null`
- `promotionTriggers: string[]`

### Prompt / Validation Requirements

- Generation must understand that the world spine is intentionally non-exhaustive.
- Minor places should be grounded in local labor, faction pressure, hazard, ritual, terrain, or trade.
- Candidate counts must stay bounded.
- Promotion triggers must be legible and mechanically meaningful.

### Acceptance Criteria

- Generated artifacts distinguish clearly between spine nodes and minor-location candidates.
- At least some spine nodes produce believable nearby minor places.
- Minor places are grounded in the parent region instead of generic filler.
- Existing runtime flow still works even though candidates are not yet full graph destinations.

## Phase 2: Information Reveals Places And Routes

### Objective

Make the knowledge layer explicitly responsible for revealing hidden places and secret routes.

We already support hidden routes and known routes at runtime, but generated information still does not carry explicit structured reveal links.

### Required Changes

Extend generated information nodes with:
- `pointsToLocationId: string | null`
- `unlocksEdgeKey: string | null`

Interpretation:
- `pointsToLocationId` means the information meaningfully points toward a place
- `unlocksEdgeKey` means the information reveals a specific hidden route

### Prompt / Validation Requirements

- Hidden routes should usually be discoverable through at least one information node.
- Minor-location candidates should be able to surface first as rumors or local leads before promotion.
- Validation should reject dead-end hidden content:
  - hidden route with no unlock
  - hidden place with no discoverable path toward it

### Acceptance Criteria

- Every hidden route is referenced by at least one information node.
- At least one hidden or gated destination in a test world is discoverable through information.
- At least one minor place can exist first as rumor/lead before promotion.

## Phase 3: Replace Remaining Over-Rigid Discoverability Validation

### Objective

Move from simple per-location assumptions to world-level discoverability rules.

We already removed some older rigid rules, but the intended end state is still not complete.

### Required Validation Model

- not every location needs a direct public lead
- every promoted location must be:
  - directly referenced by information
  - reachable through the graph
  - or indirectly pointed to through a hidden-route unlock
- every minor candidate must be either:
  - ambient local texture
  - rumor-addressable through information
  - or promotion-eligible through explicit triggers

### Acceptance Criteria

- public places still tend to receive public-facing leads through generation, not hardcoded validation
- hidden content is discoverable rather than orphaned
- worlds with sealed sites and hidden routes do not fail just because they lack a public direct lead

## Phase 4: Runtime Promotion Of Minor Locations

### Objective

Make minor-location promotion real in gameplay instead of stopping at generation artifacts.

### Runtime Behavior

- nearby minor places may exist as local texture, rumor, or partial lead before promotion
- a minor place becomes promoted when the player:
  - discovers it concretely
  - revisits it
  - travels to it
  - acts on it repeatedly
  - or causes meaningful world-state to hinge on it
- when promoted, it becomes a real location node with at least one explicit route connection

### Data Handling

Campaign state will need additive support for:
- minor-location candidates by parent location
- promoted minor-location ids
- promotion thresholds or promotion triggers used in play

### Acceptance Criteria

- a minor place can exist first as rumor or local texture and later become a real travel destination
- promotion creates explicit graph support instead of one-off narration
- travel and discovery systems can reference promoted places normally after promotion

## Phase 5: Discovery UX

### Objective

Make discovery states legible to the player.

### UI Targets

The player should be able to distinguish:
- a rumored place
- a nearby local lead
- a revealed route
- a promoted destination
- a route that still requires access

The UI should communicate:
- you know this place exists
- you know how to get there
- this is nearby but not fully charted yet
- this route is blocked pending access

### Acceptance Criteria

- newly revealed routes and places surface clearly
- the player can distinguish rumor vs route vs promoted destination
- the UX explains blocked travel without exposing schema jargon

## Phase 6: Optional Access-Requirement Deepening

### Objective

Only deepen access requirements if the current plain-text model proves too weak.

### Possible Future Upgrade

Evolve `accessRequirementText` into a compact structured requirement model only if gameplay proves the string version insufficient.

Possible fields:
- `kind: "information" | "faction" | "item" | "payment" | "status"`
- `informationId`
- `factionId`
- `itemKey`
- `note`

### Acceptance Criteria

- there is clear gameplay evidence that plain-text requirements are not enough
- the structured model stays small and does not become a quest scripting language
