# Gated World Discovery Roadmap

## Goal

Build an open-world campaign structure where the world feels physically real, socially layered, and unevenly accessible.

The world should not try to pre-materialize every explorable place in the initial world spine. Instead:

- the world spine should stay compact and authoritative
- minor villages, caves, hideouts, outposts, ruins, and local work sites should be able to exist as discoverable local-world content around spine nodes
- those minor places should become fully instantiated world entities only when play proves they matter
- discoverability should still flow primarily through routes, information, and access pressure rather than a giant dumped map

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

- Keep the initial world spine compact and authoritative.
- Treat the spine as major civic hubs, work sites, chokepoints, hazards, and anchor locations, not as an exhaustive map of every place that exists.
- Generate minor locations as local-world potential around existing spine locations, then promote them into full locations when the player discovers, revisits, uses, or materially changes them.
- Put most discoverability and access gating on routes, not on locations alone.
- Let information reveal places, routes, and requirements.
- Prefer simple structured fields over clever prompt-only heuristics.
- Avoid hardcoded taxonomies of "this type of location is always public" or "that type is always hidden."
- Avoid building a full quest engine before we have basic gated exploration working.
- Keep the engine authoritative over what is visible and traversable.

## Non-Goals For Early Phases

These are intentionally out of scope until the core loop works:

- Exhaustively generating every village, cave, camp, ruin, hideout, and building as a persistent location up front
- Full quest graph authoring
- Arbitrary scripted unlock chains
- A universal rules engine for faction trust, item keys, and permit systems
- Procedural fog-of-war rendering
- Fully unconstrained route generation at runtime
- A massive schema explosion for every possible access condition

Promotable minor locations are in scope. Arbitrary world invention is not. The intended model is:

- pre-generate or locally derive plausible minor-location candidates around existing spine locations
- reveal and promote them when discovery or repeated play makes them mechanically relevant
- attach them to the authoritative graph through explicit routes and information when promoted

## Recommended Implementation Order

1. Phase 1: Add a promotable minor-location layer around the compact world spine
2. Phase 2: Add structured hidden-route support to the world graph
3. Phase 3: Let information reveal places and unlock hidden routes
4. Phase 4: Replace over-rigid knowledge validation with discoverability rules
5. Phase 5: Make runtime route visibility and minor-location promotion depend on discovered information and play
6. Phase 6: Improve player-facing discovery UX
7. Phase 7: Deepen access requirements only if the first six phases prove valuable

## Phase 1: Promotable Minor Locations

### Objective

Preserve the small authoritative world spine while allowing the world to feel much denser at ground level.

This phase introduces a second layer of geography:

- major spine locations that always exist as full graph nodes
- minor local locations that exist as potential or lightly described places around a spine node
- promoted minor locations that become full graph nodes only when play makes them matter

The intended analogy is the current local-NPC model:

- not every ordinary person starts as a fully hydrated persistent NPC
- not every ordinary place should start as a fully materialized persistent location
- recurrence, discovery, travel, and consequence should determine what gets promoted

### Schema Changes

Add a lightweight minor-location candidate shape to generation artifacts. The exact schema can stay small, but it should support at least:

- `id`
- `parentLocationId`
- `name`
- `type`
- `summary`
- `discoveryState: "ambient" | "rumored" | "revealed" | "promoted"`
- `suggestedAccessRequirement: string | null`
- `promotionTriggers: string[]`

Interpretation:

- `ambient`: exists as local texture or implied nearby geography but is not yet a travel destination
- `rumored`: the player knows it exists in some partial way
- `revealed`: the player has a concrete lead to it but it may not yet need full graph materialization
- `promoted`: it is now a real location node with explicit routes, information hooks, and runtime support

### Prompt Changes

Update generation so the model understands:

- the world spine is intentionally not exhaustive
- each major location can imply nearby minor settlements, caves, shrines, camps, work sites, safehouses, ruins, and other local places
- these minor places should be grounded in labor, faction pressure, trade, hazard, ritual, or terrain
- minor places should not all begin fully instantiated as graph nodes
- the model should provide promotion-worthy candidates, not a bloated second full map

### Validation Changes

Add validation that ensures:

- every minor-location candidate is attached to a real spine location
- candidate types and summaries are grounded in the parent region rather than generic filler
- candidate counts stay intentionally bounded per parent location
- promotion triggers are legible and mechanically meaningful, such as discovery, revisit, travel use, faction relevance, or world-state impact

### Acceptance Criteria

- A generated world can express local density without inflating the world spine.
- At least some spine locations produce believable minor-location candidates.
- Minor locations are grounded in nearby economy, factions, hazards, or routine life.
- The stored artifact distinguishes clearly between candidate minor places and fully promoted locations.

## Phase 2: Hidden Routes in the World Graph

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

## Phase 3: Information Can Reveal Places and Routes

### Objective

Let the knowledge layer carry discoverability in a structured way.

Information should be able to do two things:

- point toward a location
- unlock a secret route

This is the minimum needed to make hidden places and promotable minor places discoverable through play.

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
- use `pointsToLocationId` for promoted minor locations once they have become real graph entities
- use `unlocksEdgeKey` when information reveals a secret route, code, chart, map, patrol gap, or guide path
- let unpromoted minor-location candidates surface first as rumors, work gossip, patrol talk, contraband directions, shrine stories, or local warnings
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
- At least one minor location can begin as a rumor or local lead before it is promoted into a full location.
- The generated artifacts preserve these references without schema or coherence failures.

## Phase 4: Replace Over-Rigid Knowledge Validation

### Objective

Stop forcing every location to have a direct public lead while still preventing dead-end worlds.

The validator should understand that some places are:

- public and directly known
- guarded and indirectly known
- hidden but discoverable through clues
- still only present as minor-location candidates until discovery or use promotes them

### Validation Model

Replace simplistic location-level rules with world-level discoverability rules:

- the knowledge web must maintain a healthy share of public information overall
- every promoted location must be either:
  - directly referenced by information
  - reachable through the graph
  - or pointed to indirectly through a secret route unlock
- every minor-location candidate must be either:
  - ambient local texture that does not yet demand traversal support
  - rumor-addressable through information
  - or eligible for promotion through explicit play triggers
- not every location needs a public direct lead

### Acceptance Criteria

- Worlds with sealed vaults, hideouts, and deep chambers no longer fail just because they lack a public direct information node.
- Obviously public places still tend to receive public-facing leads through prompting, not hardcoded validation.
- The validator catches truly dead-end content:
  - secret place with no clue
  - secret route with no unlock
  - minor place that can neither remain ambient nor ever be promoted
  - route that cannot ever become visible

## Phase 5: Runtime Route Visibility and Minor-Location Promotion

### Objective

Make gated exploration and local-place promotion real in gameplay, not just in generation artifacts.

### Runtime Behavior

When the player is at a location:

- public outgoing edges are visible
- secret outgoing edges are hidden unless unlocked
- an edge becomes visible when the player discovers the information that unlocks it
- nearby minor-location candidates may be present as local texture, rumors, or soft leads without yet existing as full travel destinations
- a minor location becomes promoted when the player discovers it concretely, revisits it, travels to it, acts on it repeatedly, or causes meaningful world-state to hinge on it

The first version can be simple:

- if discovered info contains `unlocksEdgeKey`, mark that edge as known
- if info points to a location but does not unlock a route, expose it in journals/rumors without making travel available yet
- if a minor location crosses a promotion threshold, instantiate it as a real location node plus at least one explicit route connecting it to the authoritative graph

### Data Handling

Campaign state will likely need a lightweight notion of:

- discovered information ids
- revealed edge ids or route ids
- minor-location candidates by parent location
- promoted minor-location ids

This should be additive and minimal.

### Acceptance Criteria

- A campaign can start with secret routes hidden.
- Discovering an information node can reveal at least one secret route.
- `execute_travel` cannot use a hidden route before it is revealed.
- `execute_travel` can use a revealed route afterward.
- A minor location can exist first as rumor or local texture and later become a real travel destination.
- Promotion produces explicit graph support instead of freeform one-off narration.
- Player-facing context shows the difference between:
  - a rumored place
  - a revealed route
  - a nearby minor place that is known but not yet promoted
  - a currently traversable route

## Phase 6: Player-Facing Discovery UX

### Objective

Make gated discovery feel exciting rather than confusing.

### UI Targets

Add lightweight UX for:

- rumored places
- newly revealed routes
- nearby minor places that are still only partially known
- newly promoted places
- access requirements in human-readable language
- discovered clues that now matter

The UI should tell the player:

- "You know this place exists"
- "You know how to get there"
- "This is a nearby lead, not yet a fully charted destination"
- "You still need access"

without requiring them to parse raw internal mechanics.

### Acceptance Criteria

- The player can tell why a route is hidden or unavailable.
- A newly discovered route or place is surfaced clearly in the UI.
- The player can distinguish a rumor, a nearby local lead, and a promoted destination.
- Discovered clues are legible enough that the player can form a plan.
- The UX adds clarity without exposing raw schema jargon like `unlocksEdgeKey`.

## Phase 7: Optional Access-Requirement Deepening

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

- It solves the current density problem without bloating the authoritative world spine.
- It matches the repo's existing promotion pattern for ordinary local NPCs.
- It gives later route-discovery work somewhere grounded to point beyond only major cities and anchor locations.
- It keeps runtime complexity bounded because only meaningful places get promoted.

## Phase 1 Done Means

We can say phase 1 is complete when all of the following are true:

- The world spine remains compact.
- Generation can emit bounded minor-location candidates around spine nodes.
- Candidate minor places are region-grounded and mechanically legible.
- Generated artifacts preserve the distinction between candidate and promoted locations.
- Existing runtime flow still works even though candidate places are not yet full travel nodes.

At that point, we move to Phase 2 and Phase 3 so routes and information can make those places discoverable in a controlled way.
