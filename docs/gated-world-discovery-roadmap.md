# Gated World Discovery Roadmap

## Goal

Build an open-world campaign structure where the world feels physically real, socially layered, and unevenly accessible.

The player should not experience every place as equally known or equally reachable. Instead, the world should feel like this:

- Some places are obvious and public.
- Some places are known but hard to reach.
- Some places are rumored before they are found.
- Some places become reachable only after discovering a map, earning trust, paying a toll, recovering a key, or learning a route.
- Hidden places should still feel connected to the world through clues, factions, trade, and travel pressure rather than appearing as arbitrary locked boxes.

This roadmap is intentionally phased. The end goal is ambitious, but each phase is designed to stand on its own and improve the user experience without requiring the full final architecture immediately.

## End-State Experience

An engaging player experience should eventually look like this:

1. The player begins with a believable public world.
2. They hear rumors, see patrols, buy maps, follow trade records, improve faction relations, and discover indirect leads.
3. New destinations emerge gradually rather than being fully exposed from the start.
4. Hidden routes, sealed sites, faction compounds, and monster territory become explorable because the player earned access, not because the UI dumped the full world map at launch.
5. The world remains mechanically understandable:
   - visible routes can be traversed
   - hidden routes require discovery
   - information explains why something is reachable or not
   - the engine can reason about access without a giant bespoke rule system

## Design Principles

- Put most discoverability and access gating on routes, not on locations alone.
- Let information reveal places, routes, and requirements.
- Prefer simple structured fields over clever prompt-only heuristics.
- Avoid hardcoded taxonomies of "this type of location is always public" or "that type is always hidden."
- Avoid building a full quest engine before we have basic gated exploration working.
- Keep the engine authoritative over what is visible and traversable.

## Non-Goals For Early Phases

These are intentionally out of scope until the core loop works:

- Full quest graph authoring
- Arbitrary scripted unlock chains
- A universal rules engine for faction trust, item keys, and permit systems
- Procedural fog-of-war rendering
- Fully dynamic route generation at runtime
- A massive schema explosion for every possible access condition

## Recommended Implementation Order

1. Phase 1: Add structured hidden-route support to the world graph
2. Phase 2: Let information reveal places and unlock hidden routes
3. Phase 3: Teach generation and validation to produce coherent clue chains
4. Phase 4: Make runtime route visibility depend on discovered information
5. Phase 5: Improve player-facing UI for discovery and access
6. Phase 6: Deepen access requirements only if the first five phases prove valuable

## Phase 1: Hidden Routes in the World Graph

### Objective

Introduce the smallest useful concept of gated exploration: some edges are public, some are secret, and secret routes require a concrete discovered lead or access requirement.

This phase should not attempt to model every kind of gating. It only needs to establish that the graph can distinguish:

- a place that exists
- a route that is visible
- a route that is hidden

### Schema Changes

Extend generated world-spine edges with:

- `visibility: "public" | "secret"`
- `accessRequirement: string | null`

Interpretation:

- `public`: route can be known and shown immediately
- `secret`: route exists in the graph but should not be visible/traversable by default
- `accessRequirement`: concise natural-language requirement such as:
  - `Requires a raider map`
  - `Requires permission from the Vault-Keepers`
  - `Requires a guide who knows the migration pattern`

### Prompt Changes

Update edge generation so the model understands:

- the location graph must remain connected overall
- not every route is public
- routes to hideouts, vaults, lairs, deep chambers, covert outposts, and similar sites may be secret
- secret routes need a concrete access requirement

### Validation Changes

Add graph validation that ensures:

- every location remains connected in the full graph
- secret edges always have a non-empty `accessRequirement`
- public edges may leave `accessRequirement` null

### Acceptance Criteria

- World generation succeeds with both public and secret edges in at least one nontrivial test world.
- No location becomes orphaned when secret edges are included.
- Every secret edge includes a concrete access requirement.
- The draft artifact preserves secret/public distinction for routes.
- Existing runtime behavior does not break if route visibility is ignored for now.

## Phase 2: Information Can Reveal Places and Routes

### Objective

Let the knowledge layer carry discoverability in a structured way.

Information should be able to do two things:

- point toward a location
- unlock a secret route

This is the minimum needed to make hidden places discoverable through play.

### Schema Changes

Extend generated information nodes with:

- `pointsToLocationId: string | null`
- `unlocksEdgeKey: string | null`

Interpretation:

- `pointsToLocationId` means the info meaningfully points toward a place, even if it does not make that place fully traversable yet
- `unlocksEdgeKey` means discovering this information reveals a specific secret route

### Prompt Changes

Pass secret edges into the knowledge-web stage and instruct the model:

- use `pointsToLocationId` when rumors, maps, records, brokers, or gossip point toward a place
- use `unlocksEdgeKey` when information reveals a secret route, code, chart, map, patrol gap, or guide path
- not every info node needs one of these fields, but hidden content should usually be discoverable through one of them

### Validation Changes

Validate that:

- `pointsToLocationId` references a known location when present
- `unlocksEdgeKey` references a known secret edge when present
- at least one information node references each secret edge
- hidden/special locations are usually referenced either by `pointsToLocationId` or by a reachable secret route

### Acceptance Criteria

- Knowledge generation succeeds with structured route/location reveals.
- Every secret edge is referenced by at least one information node.
- At least one hidden or special place in a test world is discoverable through information rather than direct public access.
- The generated artifacts preserve these references without schema or coherence failures.

## Phase 3: Replace Over-Rigid Knowledge Validation

### Objective

Stop forcing every location to have a direct public lead while still preventing dead-end worlds.

The validator should understand that some places are:

- public and directly known
- guarded and indirectly known
- hidden but discoverable through clues

### Validation Model

Replace simplistic location-level rules with world-level discoverability rules:

- the knowledge web must maintain a healthy share of public information overall
- every location must be either:
  - directly referenced by information
  - reachable through the graph
  - or pointed to indirectly through a secret route unlock
- not every location needs a public direct lead

### Acceptance Criteria

- Worlds with sealed vaults, hideouts, and deep chambers no longer fail just because they lack a public direct information node.
- Obviously public places still tend to receive public-facing leads through prompting, not hardcoded validation.
- The validator catches truly dead-end content:
  - secret place with no clue
  - secret route with no unlock
  - route that cannot ever become visible

## Phase 4: Runtime Route Visibility and Unlocking

### Objective

Make gated exploration real in gameplay, not just in generation artifacts.

### Runtime Behavior

When the player is at a location:

- public outgoing edges are visible
- secret outgoing edges are hidden unless unlocked
- an edge becomes visible when the player discovers the information that unlocks it

The first version can be simple:

- if discovered info contains `unlocksEdgeKey`, mark that edge as known
- if info points to a location but does not unlock a route, expose it in journals/rumors without making travel available yet

### Data Handling

Campaign state will likely need a lightweight notion of:

- discovered information ids
- revealed edge ids or route ids

This should be additive and minimal.

### Acceptance Criteria

- A campaign can start with secret routes hidden.
- Discovering an information node can reveal at least one secret route.
- `execute_travel` cannot use a hidden route before it is revealed.
- `execute_travel` can use a revealed route afterward.
- Player-facing context shows the difference between:
  - a rumored place
  - a revealed route
  - a currently traversable route

## Phase 5: Player-Facing Discovery UX

### Objective

Make gated discovery feel exciting rather than confusing.

### UI Targets

Add lightweight UX for:

- rumored places
- newly revealed routes
- access requirements in human-readable language
- discovered clues that now matter

The UI should tell the player:

- "You know this place exists"
- "You know how to get there"
- "You still need access"

without requiring them to parse raw internal mechanics.

### Acceptance Criteria

- The player can tell why a route is hidden or unavailable.
- A newly discovered route or place is surfaced clearly in the UI.
- Discovered clues are legible enough that the player can form a plan.
- The UX adds clarity without exposing raw schema jargon like `unlocksEdgeKey`.

## Phase 6: Optional Access-Requirement Deepening

### Objective

Only if the earlier phases prove fun and stable, deepen access requirements beyond freeform strings.

### Possible Future Upgrade

If needed later, evolve `accessRequirement` from plain text into a lightweight structured shape such as:

- `kind: "information" | "faction" | "item" | "payment" | "status"`
- `informationId`
- `factionId`
- `itemKey`
- `note`

Do not do this until we have evidence the string-based version is insufficient.

### Acceptance Criteria

- There is a demonstrated gameplay need that plain-text requirements cannot support cleanly.
- Existing string-based content has proven valuable enough to justify structured expansion.
- The structured model remains small and does not become a general-purpose quest language.

## Risks and Mitigations

### Risk: Overengineering Before Playability Is Proven

Mitigation:

- Keep phase 1 and phase 2 intentionally small
- avoid full quest-chain logic
- validate only what the engine can actually use

### Risk: Hidden Content Becomes Unreachable

Mitigation:

- require secret edges to have unlockable information
- validate graph connectivity in the full graph
- validate references between knowledge and secret routes

### Risk: Prompt Complexity Reintroduces Truncation

Mitigation:

- keep the first edge and information additions small
- prefer one or two new fields over large nested objects
- continue splitting oversized generation stages when necessary

### Risk: The Player Becomes Confused About Why Travel Is Blocked

Mitigation:

- expose route visibility and access requirements in plain UI language
- distinguish rumors from usable routes
- make revealed routes visually and textually clear

## What We Should Start With

Start with Phase 1.

Why:

- It adds the smallest durable primitive: hidden vs public routes.
- It does not require immediate runtime refactors.
- It creates the foundation for more accurate knowledge generation later.
- It gives us a clean place to attach discovery mechanics instead of forcing discoverability onto locations directly.

## Phase 1 Done Means

We can say phase 1 is complete when all of the following are true:

- The world-spine edge schema supports `visibility` and `accessRequirement`.
- The edge-generation prompt can produce both public and secret routes.
- Validation guarantees the graph stays connected and secret routes are well-formed.
- Generated artifacts preserve this data.
- Existing runtime flow still works even if secret routes are not yet hidden in the UI.

At that point, we move to Phase 2 and make information actually reveal those routes.
