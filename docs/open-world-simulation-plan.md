# Open World Simulation Migration Plan v3 (Synthesized)

## Implementation Status

### Completed In Pass 1

- [x] Destructive schema cutover to graph-first module and campaign storage
- [x] `openWorldTemplateJson` added as generation storage on `AdventureModule`
- [x] Graph module generation pipeline producing locations, edges, factions, NPCs, information, economy, and entry points
- [x] Entry-point selection in the launch flow
- [x] Campaign graph materialization into relational world tables at launch
- [x] Spatial prompt context anchored on `currentLocationId`
- [x] Cross-location information traversal up to 2 hops from discovered information
- [x] Native action-tool turn loop for `execute_travel`, `execute_converse`, `execute_investigate`, `execute_observe`, `execute_wait`, `execute_freeform`, and `request_clarification`
- [x] Strict `TIME_MODE_BOUNDS` validation and engine-owned travel-time enforcement
- [x] Frontend spatial panels for local area, known factions, discovered information, and journal

### Next For Future Agents

- [ ] Implement `execute_combat`
- [ ] Implement `execute_trade`
- [ ] Implement `execute_rest`
- [ ] Add typed `NpcRoutine.triggerCondition` evaluator
- [ ] Build autonomous simulation tick
- [ ] Schedule and cancel `FactionMove` reactions
- [ ] Execute `WorldEvent` payloads
- [ ] Add `SimulationInverse[]` rollback plumbing for simulation writes
- [ ] Expand the world-fidelity audit beyond entity-membership validation
- [ ] Add lazy deep-context fetch budgeting and performance optimization

`openWorldTemplateJson` is generation storage only. After campaign creation, runtime reads come from campaign relational tables and `CampaignRuntimeState`.

## Summary

This document synthesizes two prior architectural proposals into a single coherent migration plan. It combines the resilience and failure-mode analysis of v2-mine with the latency and agency improvements of v2-theirs.

**Core architectural principles, reconciled:**

- The TypeScript engine owns all world state mutation, time, and spatial queries.
- The AI translates world state into sensory prose and translates player intent into engine commands via native tool calling.
- Context is lazy-loaded — the AI receives a thin base context and fetches deep data on demand via tools, preventing context collapse and latency bloat.
- The world timeline is JIT-generated daily, not upfront, keeping generation fast and reactive.
- Every simulation tick mutation is perfectly invertible via shadow state tracking.
- The AI is forbidden from inventing mechanical facts. It is required to invent sensory detail.

**Where the two prior plans disagreed and how this resolves it:**

| Topic | v2-mine | v2-theirs | Resolution |
|-------|---------|-----------|------------|
| Context delivery | Full spatial bubble, cached | Thin base + tool fetch | Theirs wins. Lazy loading is architecturally superior. |
| Intent parsing | Two-step: parse then resolve | Native tool calling | Theirs wins. Eliminates a round-trip and double-latency. |
| Creative player actions | Compound intent type | Freeform escape hatch tool | Theirs wins. More practical and preserves agency. |
| Timeline generation | 40-event upfront batch | JIT per day | Theirs wins. Prevents timeout, more reactive. |
| Rollback | Full pre-tick snapshot | Inverse writes as-you-go | Theirs wins. More memory-efficient, handles complex tx. |
| Sensory invention | Zero invention rule (too strict) | Invent sensory, not mechanical | Theirs wins. Mine would produce sterile output. |
| Failure mode mitigation | Full premortem, 12 mitigations | Not documented | Mine wins. All FM mitigations carried forward. |
| Cascade limits | Hard cap, depth tracking | Not present | Mine wins. Real failure risk without it. |
| Playability validation | Separate pass | Not present | Mine wins. Coherence alone is insufficient. |
| Module versioning | Full versioning contract | Not present | Mine wins. Blocks production without it. |
| World-fidelity audit | Replaces old audit | Not addressed | Mine wins. Old audit is incompatible with renderer mode. |
| Character depth | Complete feature (Phase 7) | Not present | Mine wins. Schema-only is useless. |
| Typed payloads | Discriminated union | Json (untyped) | Mine wins. Untyped payloads fail silently. |

---

## Premortem: What This Architecture Was Revised to Prevent

Before reading the plan, read what the plan was revised to prevent. These 12 failure modes were identified by simulating a 6-month failure scenario. Each has a mitigation built into the relevant phase.

**FM-1: The AI ignores the zero invention rule for mechanical facts.**
Prompt instructions alone don't prevent this. Addressed by: entity citation requirement + world-fidelity audit in Phase 6.

**FM-2: Simulation tick creates unsolvable rollback problems.**
Shadow state (inverse write tracking) must be complete before the tick ships. Addressed by: Phase 2 inverse rollback structure and Phase 4 tick safety requirements.

**FM-3: Intent parsing fails on compound and creative actions.**
Rigid typed intents fight against natural player expression. Addressed by: native tool calling + freeform escape hatch in Phase 6.

**FM-4: Staged generation produces valid but unplayable worlds.**
Coherence validation catches structural errors, not engagement problems. Addressed by: playability validation pass in Phase 5.

**FM-5: Long generation times destroy developer iteration.**
Full regeneration on every change is untenable. Addressed by: incremental per-stage regeneration in Phase 5, plus JIT daily timeline in Phase 4.

**FM-6: Faction response cascades loop out of control.**
Reactive faction moves can chain indefinitely. Addressed by: cascade depth field and hard cap in Phase 4.

**FM-7: Information expiry contradicts player memory.**
Expired information leaves player memory inconsistent with the world. Addressed by: expiry cascade rules in Phase 2, player-carried layer immunity in Phase 3.

**FM-8: The existing narration audit is incompatible with renderer mode.**
Old audit rules flag legitimate world-state reporting as violations. Addressed by: mode-sensitive audit in Phase 6.

**FM-9: Character depth fields are added to the schema but nothing uses them.**
Schema-only additions are waste. Addressed by: Phase 7 is a complete feature specification, not a schema stub.

**FM-10: Module versioning is deferred but breaks production on week one.**
Cannot fix a module with active campaigns without a versioning contract. Addressed by: module versioning as Phase 5 prerequisite.

**FM-11: Spatial bubble severs cross-location information connections.**
The information web's value is cross-space links; spatial isolation cuts them. Addressed by: `fetch_information_connections` tool in Phase 3.

**FM-12: Context assembly performance degrades at scale.**
12-15 joins per turn on a large world is slow without explicit strategy. Addressed by: lazy loading architecture in Phase 3 + index strategy in Phase 2.

---

## Recommended Execution Order

1. **Phase 2** — Schema expansion and inverse rollback structures. Pure addition, nothing breaks.
2. **Phase 5** — JIT generation pipeline. Build the world model before touching the runtime.
3. **Phase 3** — Lazy-loaded context assembly. Validate in isolation before wiring to AI.
4. **Phase 4 + Phase 1** — Simulation tick and temporal clock together. Tick requires time; time requires tick to be meaningful.
5. **Phase 6** — Tool calling integration and prompt overhaul. Last, once the engine supports the behaviors.
6. **Phase 7** — Character depth as a complete feature.

---

## Phase 1: Temporal Decoupling

### 1. Schema

```prisma
model Campaign {
  // ... existing fields
  globalTime Int @default(0) // in-game minutes since campaign start
}
```

### 2. Time Modes

```typescript
type TimeMode = "combat" | "exploration" | "travel" | "rest" | "downtime";

const TIME_MODE_BOUNDS: Record<TimeMode, { min: number; max: number }> = {
  combat:      { min: 1,   max: 10   },
  exploration: { min: 5,   max: 240  },
  travel:      { min: 0,   max: 0    }, // ALWAYS derived from LocationEdge — never AI-estimated
  rest:        { min: 0,   max: 0    }, // ALWAYS fixed: 360 (light) or 480 (full)
  downtime:    { min: 60,  max: 2880 },
};
```

Travel and rest times are engine-derived only. The AI cannot shorten or extend them.

If the AI omits `timeMode`, the engine throws — no silent defaults. If the AI provides a value outside bounds, clamp and warn. Time must be explicitly modeled on every turn.

### 3. Type Contracts

```typescript
// Extend ProposedStateDelta
timeMode?: TimeMode;
timeElapsed?: number;

// Extend ValidatedDelta
timeElapsed: number;
timeMode: TimeMode;

// Extend TurnFacts
timeElapsed: number;
timeMode: TimeMode;
globalTimeAfter: number;
```

---

## Phase 2: World State Schema Expansion

New models are **additive**. Existing models remain until explicit migration. Never drop a working table to replace it. Run old and new in parallel.

### 1. Inverse Rollback Structure

Every simulation tick mutation must be perfectly invertible. As the tick executes, it pushes the inverse of each database write into the rollback record:

```typescript
type SimulationInverse = {
  table: string;
  id: string;
  field: string;
  previousValue: unknown;
  operation: "update" | "delete_created"; // delete_created = undo a newly created record
};

// Extend existing TurnRollbackData
type TurnRollbackData = {
  // ... all existing fields preserved
  simulationInverses: SimulationInverse[];
};
```

Rolling back a turn reads `simulationInverses` in reverse order and applies each inverse. This handles arbitrarily complex ticks without requiring full table snapshots.

### 2. Index Strategy (FM-12)

Establish these indexes before writing any context assembly queries:

```sql
CREATE INDEX idx_npc_location        ON "NPC"("currentLocationId") WHERE "currentLocationId" IS NOT NULL;
CREATE INDEX idx_world_event_tick    ON "WorldEvent"("campaignId", "triggerTime", "isProcessed", "isCancelled");
CREATE INDEX idx_information_spatial ON "Information"("campaignId", "locationId", "isDiscovered");
CREATE INDEX idx_faction_move_sched  ON "FactionMove"("campaignId", "scheduledAtTime", "isExecuted", "isCancelled");
CREATE INDEX idx_npc_routine_time    ON "NpcRoutine"("triggerTimeMinutes");
CREATE INDEX idx_market_price_loc    ON "MarketPrice"("locationId");
```

### 3. Geography

```prisma
model LocationNode {
  id                   String         @id @default(cuid())
  campaignId           String
  name                 String
  type                 String         // city | district | dungeon | wilderness | ruin | stronghold | building
  controllingFactionId String?
  wealthLevel          Int            @default(3) // 1-5
  scarcityTags         String[]
  abundanceTags        String[]
  currentState         String         @default("active") // active | contested | abandoned | ruined
  isPublic             Boolean        @default(true)
  secrets              String[]
  createdAt            DateTime       @default(now())
  campaign             Campaign       @relation(fields: [campaignId], references: [id], onDelete: Cascade)
  controllingFaction   Faction?       @relation(fields: [controllingFactionId], references: [id])
  edgesFrom            LocationEdge[] @relation("EdgeSource")
  edgesTo              LocationEdge[] @relation("EdgeTarget")
  npcs                 NPC[]
  events               WorldEvent[]
  information          Information[]
  marketPrices         MarketPrice[]

  @@index([campaignId])
  @@index([controllingFactionId])
}

model LocationEdge {
  id                String       @id @default(cuid())
  campaignId        String
  sourceId          String
  targetId          String
  travelTimeMinutes Int          // authoritative travel time — engine reads this, AI does not estimate it
  dangerLevel       Int          @default(1)
  isPassable        Boolean      @default(true)
  controlledBy      String?
  currentStatus     String       @default("open") // open | contested | blocked | taxed

  @@index([campaignId, sourceId])
  @@index([campaignId, targetId])
}
```

**Graph connectivity requirement:** Every `LocationNode` must be reachable from every other via `LocationEdge` traversal. The coherence validator enforces this at generation time.

### 4. Factions

```prisma
model Faction {
  id               String            @id @default(cuid())
  campaignId       String
  name             String
  type             String
  agenda           String
  resources        Json              // { gold: number, military: number, influence: number, information: number }
  pressureClock    Int               @default(0)
  maxPressureClock Int               @default(10)
  currentObjective String
  isDefeated       Boolean           @default(false)
  createdAt        DateTime          @default(now())

  @@index([campaignId])
}

model FactionRelation {
  id         String  @id @default(cuid())
  factionAId String
  factionBId String
  stance     String  // allied | neutral | rival | war

  @@unique([factionAId, factionBId])
}

model FactionMove {
  id                 String   @id @default(cuid())
  factionId          String
  campaignId         String
  scheduledAtTime    Int
  description        String
  payload            Json     // typed SimulationPayload — see Phase 4
  isExecuted         Boolean  @default(false)
  isCancelled        Boolean  @default(false)
  cancellationReason String?
  cascadeDepth       Int      @default(0) // FM-6: cascade depth tracked here

  @@index([campaignId, scheduledAtTime, isExecuted, isCancelled])
}
```

### 5. NPC Extensions

Extend existing `NPC` model — do not recreate it:

```prisma
// Add to existing NPC model:
factionId          String?
currentLocationId  String?
routines           NpcRoutine[]
knowledge          NpcKnowledge[]

model NpcRoutine {
  id                 String       @id @default(cuid())
  npcId              String
  triggerTimeMinutes Int          // time of day in minutes 0-1440
  triggerCondition   Json?        // typed RoutineCondition (see below)
  targetLocationId   String
  activity           String
  priority           Int          @default(0)

  @@index([triggerTimeMinutes])
}

model NpcKnowledge {
  id            String @id @default(cuid())
  npcId         String
  informationId String
  willShareWith String @default("trusted") // anyone | trusted | never

  @@unique([npcId, informationId])
}
```

**Condition Contract** — `triggerCondition` must be typed, never free JSON. Unrecognized condition types default to `false` and log a warning:

```typescript
type RoutineCondition =
  | { type: "location_state"; locationId: string; state: LocationState }
  | { type: "faction_at_war"; factionId: string }
  | { type: "npc_state"; npcId: string; state: NpcState }
  | { type: "time_range"; minMinutes: number; maxMinutes: number }
  | { type: "player_in_location"; locationId: string }
  | { type: "and"; conditions: RoutineCondition[] }
  | { type: "or"; conditions: RoutineCondition[] };
```

### 6. Information Web

**Do not drop the `Clue` table.** Run `Information` in parallel. Backfill via migration script. Deprecate `Clue` only after all active campaigns are migrated.

**Expiry cascade rules (FM-7):** When an `Information` record expires, before deletion: links of type `supports`/`extends` downgrade the target to `truthfulness: "partial"` rather than deleting it. Links of type `unlocks` are permanent — unlocking is a one-time event. Player-discovered information **is never deleted from session memory** regardless of world-side expiry. The AI treats player memory of expired information as "believed but potentially outdated."

```prisma
model Information {
  id             String         @id @default(cuid())
  campaignId     String
  content        String
  truthfulness   String         @default("true") // true | partial | false | outdated
  accessibility  String         @default("guarded") // public | guarded | secret
  sourceType     String
  sourceId       String?
  expiresAtTime  Int?
  locationId     String?
  isDiscovered   Boolean        @default(false)
  discoveredAtTurn Int?
  createdAt      DateTime       @default(now())

  @@index([campaignId, isDiscovered])
  @@index([campaignId, locationId])
  @@index([expiresAtTime])
}

model InformationLink {
  id       String @id @default(cuid())
  sourceId String
  targetId String
  linkType String // supports | contradicts | extends | unlocks

  @@unique([sourceId, targetId])
}
```

### 7. World Events and Economy

```prisma
model WorldEvent {
  id               String   @id @default(cuid())
  campaignId       String
  locationId       String?
  triggerTime      Int
  triggerCondition Json?    // typed RoutineCondition — same evaluator as NpcRoutine
  description      String
  payload          Json     // typed SimulationPayload — see Phase 4
  isProcessed      Boolean  @default(false)
  isCancelled      Boolean  @default(false)
  cascadesFrom     String?
  cascadeDepth     Int      @default(0) // FM-6

  @@index([campaignId, triggerTime, isProcessed, isCancelled])
}

model Commodity {
  id         String @id @default(cuid())
  campaignId String
  name       String
  baseValue  Int
  tags       String[] // food | weapon | tool | luxury | contraband | material
}

model MarketPrice {
  id          String  @id @default(cuid())
  commodityId String
  locationId  String
  modifier    Float   @default(1.0)
  stock       Int     @default(-1) // -1 = unlimited
  restockTime Int?
  legalStatus String  @default("legal") // legal | restricted | contraband
  vendorNpcId String?

  @@unique([commodityId, locationId, vendorNpcId])
  @@index([locationId])
}
```

---

## Phase 3: Lazy-Loaded Context Assembly

The AI receives a thin base context on every turn and fetches deep data on demand via tools. This prevents context collapse and the 20-second latency problem of passing a full spatial bubble.

### 1. Base Context (Every Turn)

```typescript
type BasePromptContext = {
  // Spatial — names and summaries only, no deep data
  currentLocation: { id: string; name: string; type: string; state: string };
  adjacentRoutes: { locationId: string; locationName: string; travelTimeMinutes: number; dangerLevel: number; status: string }[];
  presentNpcNames: string[]; // names only — detail fetched via tool
  recentLocalEvents: string[]; // 1-sentence summaries of events fired in the last 60 in-game minutes

  // Player-carried — always present, immune to spatial filtering and expiry
  recentTurnLedger: string[];
  activeQuests: QuestRecord[];
  inventory: PromptInventoryItem[];
  characterRelationships: { npcName: string; approvalLevel: string }[];
  discoveredInformationSummaries: string[]; // brief summaries, not full text

  // Clock
  globalTime: number;
  timeOfDay: string;  // morning | afternoon | evening | night
  dayCount: number;
};
```

### 2. On-Demand Tool Fetch Endpoints

The AI calls these tools when the player's action requires deeper context. Each tool is a fast indexed query, not a join cascade.

```typescript
// Returns full NPC record + their public and (if trust threshold met) guarded knowledge
fetch_npc_detail(npcId: string) -> NpcDetail

// Returns commodity prices, stock, legality, and vendor NPC names at a location
fetch_market_prices(locationId: string) -> MarketPriceList

// Returns faction resources, relationships, known moves
fetch_faction_intel(factionId: string) -> FactionIntel

// Returns full text of a specific information node the player has discovered
fetch_information_detail(informationId: string) -> Information

// FM-11: Follows InformationLink edges from player-discovered nodes, up to 2 hops
// Returns connected information that the player's prior knowledge touches
// Does NOT auto-discover — explicit player action still required
fetch_information_connections(informationIds: string[]) -> InformationConnection[]

// Returns the player's relationship history with an NPC
fetch_relationship_history(npcId: string) -> RelationshipHistory
```

**Tool call budget per turn:** Maximum 3 tool fetches per turn before narration. If the player's action plausibly requires more than 3 context fetches, the base context summary is insufficient — this signals a context assembly gap, not a tool budget problem. Fix it in the base context layer, not by raising the tool limit.

### 3. The Zero Invention Rule — Mechanical vs. Sensory (FM-1)

**State invention is forbidden:** The AI cannot invent named NPCs, factions, market commodities, prices, or mechanically relevant items not present in the database. These are facts about a world that exists.

**Sensory invention is required:** The AI is explicitly instructed to invent the smell of the docks, the heat of the forge, the tone of an NPC's voice, ambient crowd behavior, weather texture, and atmospheric detail. This is the prose layer that makes deterministic state feel alive.

The distinction: if it affects the game state, it must come from the database. If it only affects immersion, the AI should create it freely.

**Enforcement (FM-1 mitigation):** The AI must include a `citedMechanicalEntities` field in its tool payload listing every NPC name, location, faction, and commodity it referenced as a mechanical fact in the narration. The engine validates each against the assembled context. Any uncited mechanical entity triggers a `hallucinated_entity` world-fidelity issue.

```typescript
citedMechanicalEntities: {
  npcIds: string[];
  locationIds: string[];
  factionIds: string[];
  commodityIds: string[];
}
```

---

## Phase 4: The Inverse Simulation Loop

The engine mutates world state independently of player actions. Every mutation is invertible.

### 1. JIT Daily Timeline Generation (FM-5 mitigation)

Do not generate a 10,000-minute world timeline at campaign creation. This causes generation timeouts and wastes computation on events that may never fire.

**When `commitValidatedTurn()` rolls `globalTime` into a new day** (i.e., `newTime % 1440 < previousTime % 1440`), before executing the tick:

1. Package the current state of all factions, location control, and any player-visible actions from the previous day.
2. Call the AI to generate `WorldEvent` and `FactionMove` records for the next 24 hours only.
3. Events are reactive — they reflect what actually happened the previous day, not a fixed script.
4. Validate generated events against the typed `SimulationPayload` schema before committing.

This keeps generation fast, prevents upfront timeouts, and ensures the world responds to what the player does.

**Edge case:** If the player skips multiple days (e.g., via long downtime), generate each day sequentially, each informed by the simulated state after the previous day's events resolved. Cap at 7 days of sequential generation before surfacing a "time has passed, things have changed significantly" summary to the player.

### 2. Execution Hook

In `commitValidatedTurn()`, in order:

1. Check if day rollover occurs — if so, run JIT generation first.
2. Capture pre-tick state in `simulationInverses` (initially empty).
3. Apply the player's validated delta.
4. Advance `globalTime`.
5. Execute `runSimulationTick(tx, previousTime, newTime, inverses)`.
6. Run world stability check.
7. Write the complete `TurnRollbackData` including `simulationInverses`.

### 3. Tick Operations

**NPC Routing**
Find `NpcRoutine` records where `triggerTimeMinutes` falls in the elapsed window, accounting for day rollover. When multiple routines fire simultaneously for one NPC, highest `priority` wins. Push `{ table: "NPC", id, field: "currentLocationId", previousValue }` to inverses before each update.

Evaluate `triggerCondition` using the typed condition evaluator. Unrecognized types → `false`, never `true`.

**Event Resolution**
Find `WorldEvent` where `triggerTime <= newTime`, `isProcessed == false`, `isCancelled == false`. For each:
1. Evaluate `triggerCondition` if present. Skip (do not mark processed) if unsatisfied.
2. Push inverses for all fields the payload will mutate.
3. Execute `SimulationPayload` via typed pattern matcher.
4. Set `isProcessed = true`. Push `{ previousValue: false }` for this field.
5. Queue cascading events at `cascadeDepth = event.cascadeDepth + 1`.

**Faction Response Pass**
Check for critical faction state changes (leader killed, territory lost, resource threshold crossed). For each affected faction:
1. Cancel invalid `FactionMove` records — push cancel inverses.
2. Queue reactive `FactionMove` records — push `delete_created` markers for rollback.

**Cascade Depth Enforcement (FM-6)**

```typescript
const MAX_CASCADE_DEPTH = 3;

if (event.cascadeDepth >= MAX_CASCADE_DEPTH) {
  console.warn(`[sim.tick] Cascade depth limit reached at event ${event.id}. Cascade terminated.`);
  continue;
}
```

**World Stability Check**

After tick completes, flag for investigation (do not throw):

```typescript
if (factionStateChanges > 2 || locationStateChanges > 3 || unexpectedNpcMoves > 5) {
  console.warn("[sim.tick] Stability threshold exceeded. Possible cascade loop.");
}
```

**Garbage Collection**
Apply information expiry cascade rules before deletion. Restore market stock for `restockTime <= newTime`.

### 4. Typed Simulation Payloads

Unrecognized payload types throw — no silent failures:

```typescript
type SimulationPayload =
  | { type: "change_location_state"; locationId: string; newState: LocationState }
  | { type: "change_faction_control"; locationId: string; factionId: string | null }
  | { type: "change_npc_state"; npcId: string; newState: NpcState }
  | { type: "change_faction_resources"; factionId: string; delta: Partial<FactionResources> }
  | { type: "spawn_world_event"; event: NewWorldEventPayload }
  | { type: "spawn_information"; information: NewInformationPayload }
  | { type: "cancel_faction_move"; factionMoveId: string; reason: string }
  | { type: "change_route_status"; edgeId: string; newStatus: RouteStatus }
  | { type: "change_market_price"; marketPriceId: string; newModifier: number }
  | { type: "transfer_location_control"; locationId: string; fromFactionId: string; toFactionId: string }
  | { type: "change_npc_location"; npcId: string; newLocationId: string };
```

### 5. Undo Execution

When `retryLastTurn()` runs, after reversing the player delta, read `simulationInverses` in **reverse** order and apply each inverse write. This restores the world state regardless of how many simulation events fired.

```typescript
async function undoSimulationTick(tx: Prisma.TransactionClient, inverses: SimulationInverse[]) {
  for (const inverse of [...inverses].reverse()) {
    if (inverse.operation === "delete_created") {
      await tx[inverse.table].delete({ where: { id: inverse.id } });
    } else {
      await tx[inverse.table].update({
        where: { id: inverse.id },
        data: { [inverse.field]: inverse.previousValue },
      });
    }
  }
}
```

---

## Phase 5: JIT Generation Pipeline

### 1. Module Versioning Contract (FM-10 — must be complete before generation ships)

```prisma
model AdventureModule {
  // ... existing fields
  schemaVersion Int     @default(1)
  isLocked      Boolean @default(false) // true once any campaign uses this module
}

model Campaign {
  // ... existing fields
  moduleSchemaVersion Int @default(1)
}
```

**Compatibility rule:** Modules are never mutated in place once locked. Bug fixes create a new version. Existing campaigns continue on their original version. New campaigns use the patched version. One-time migration is offered to existing players, never forced.

### 2. Generation Stages (Initial World State Only)

No upfront timeline generation. Only spatial layout and starting conditions. The timeline is JIT-generated in Phase 4.

**Stage 1 — Geography:** 8-15 `LocationNode` and `LocationEdge` records. Full graph connectivity required. Validated before Stage 2.

**Stage 2 — Factions:** 3-6 factions. At least one that could be a player ally. Symmetric relationships. 0 scheduled moves at generation — the daily JIT tick generates moves reactively.

**Stage 3 — NPCs:** 10-20 named NPCs. Typed routines. NPC distribution validated against playability concentration rule.

**Stage 4 — Knowledge Web:** Information nodes linked to NPCs and locations. At least 30% publicly accessible. All `InformationLink` targets exist in the same generation batch.

**Stage 5 — Economy:** Commodities, market prices per location, initial vendor assignments.

**Stage 6 — Entry Points:** 3-5 entry contexts. Starting location reachable to all others within 4 hops. Initial information IDs validated against Stage 4.

### 3. Incremental Regeneration (FM-5)

Each stage is independently re-runnable with its dependencies pinned:

```typescript
async function regenerateStage(
  moduleId: string,
  stage: GenerationStage,
  customPrompt?: string,
): Promise<void> {
  const existing = await loadModuleStages(moduleId);
  const priorStages = getPriorStages(stage, existing);
  const result = await runStageWithRetry(stage, priorStages, customPrompt);

  const coherence = validateCoherence({ ...existing, [stage]: result });
  if (!coherence.isCoherent) throw new RegenerationCoherenceError(coherence.issues);

  await saveStage(moduleId, stage, result);
}
```

Developer iteration: find a problem in Stage 3, re-run Stage 3 only (2-3 minutes). No full regeneration.

### 4. Coherence Validation

```typescript
function validateCoherence(module: PartialGeneratedModule): CoherenceReport {
  // All LocationEdge source/target IDs exist in geography
  // All Faction territory location IDs exist in geography
  // All NPC factionIds exist in factions
  // All NPC startingLocationIds exist in geography
  // All NpcRoutine targetLocationIds exist in geography
  // All InformationLink source/target IDs exist in knowledge
  // All EntryPoint startingLocationIds exist in geography
  // All EntryPoint initialInformationIds exist in knowledge
  // FactionRelations are symmetric
  // Graph is fully connected
}
```

### 5. Playability Validation (FM-4)

Separate from coherence. Catches engagement failures, not structural ones.

```typescript
function validatePlayability(module: GeneratedModule): PlayabilityReport {
  // At least one faction that is not at war with all others (player can find an ally)
  // No single location contains more than 40% of all NPCs
  // No faction's pressure clock can max out within 50 turns given starting agenda pace
  // At least 30% of information is publicly accessible without faction trust
  // Every location reachable from every entry point within 4 travel hops
}
```

Block on structural playability failures. Warn on soft ones. Surface to the user — do not auto-repair playability, as the fix changes the world's character.

### 6. Targeted Retry Logic

```typescript
async function runStageWithRetry<T>(
  stageFn: StageFn<T>,
  context: StageContext,
  schema: ZodSchema<T>,
  attempt = 0,
): Promise<T> {
  const raw = await stageFn(context);
  const parsed = schema.safeParse(raw);
  if (parsed.success) return parsed.data;
  if (attempt >= 3) throw new StageGenerationError(stageFn.name, parsed.error);

  const correctionPrompt = buildCorrectionPrompt(stageFn.name, parsed.error, context);
  return runStageWithRetry(stageFn, { ...context, prompt: correctionPrompt }, schema, attempt + 1);
}
```

---

## Phase 6: Tool Calling Integration and Prompt Realignment

### 1. Native Tool Calling Replaces Two-Step Intent Parsing

The AI prompt includes tools that map directly to engine operations. One call per turn — the AI fetches context it needs, then emits the action tool. No separate intent-parse step, no double latency.

```typescript
// Context fetch tools (called before action if needed)
fetch_npc_detail(npcId: string)
fetch_market_prices(locationId: string)
fetch_faction_intel(factionId: string)
fetch_information_detail(informationId: string)
fetch_information_connections(informationIds: string[])
fetch_relationship_history(npcId: string)

// Action tools (one per turn — the actual engine operation)
execute_travel(targetLocationId: string, routeEdgeId: string)
execute_converse(npcId: string, topic: string, subject?: string)
execute_investigate(targetId: string, targetType: string, method: string)
execute_trade(npcId: string, action: "buy" | "sell", commodityId: string, quantity: number)
execute_rest(restType: "light" | "full")
execute_combat(targetNpcId: string, approach: "attack" | "subdue" | "assassinate")
execute_observe(targetId: string, targetType: string)
execute_wait(durationMinutes: number)
```

### 2. The Freeform Escape Hatch (FM-3)

Players will attempt actions outside rigid mechanics — "I kick the brazier onto the guards," "I forge a convincing copy of the letter." These cannot be mapped to a typed intent without destroying agency.

```typescript
execute_freeform({
  actionDescription: string;          // what the player is doing
  statToCheck: Stat;                   // engine rolls this
  dc?: number;                         // optional — engine can derive if omitted
  timeMode: TimeMode;
  estimatedTimeElapsedMinutes: number; // engine enforces against TimeMode bounds
  intendedMechanicalOutcome: string;   // if check succeeds, engine applies this description
  failureConsequence?: string;         // if check fails
})
```

The engine rolls the specified stat against the DC. If successful, it applies the generic outcome as a narrative fact (not a structured delta — it becomes a memory entry) and advances the clock. The freeform outcome cannot directly mutate faction resources, NPC states, or location control — those remain in the typed payload domain. It can trigger consequences that queue typed events.

**This is the correct resolution to FM-3.** A typed intent vocabulary is necessary for common operations. An escape hatch is necessary for player creativity. Both are required; neither alone is sufficient.

### 3. World-Fidelity Audit Replaces Old Narration Audit for Renderer Turns (FM-8)

The existing narration audit (player psychology, editorial closer, action deferral) was designed for a storyteller AI. It remains active for **combat and investigation turns** where moment-to-moment action narration is primary.

It is **replaced** by a world-fidelity audit for **exploration, conversation, and observation turns** where the AI is acting as a sensory renderer:

```typescript
type WorldFidelityIssue = {
  code:
    | "hallucinated_entity"       // cited entity not in assembled context
    | "uncited_mechanical_entity" // mechanical entity in narration not in citedMechanicalEntities
    | "invented_price"            // price stated not in market state
    | "invented_fact"             // information stated not in provided information nodes
    | "temporal_inconsistency"    // narration contradicts established world time
    | "spatial_inconsistency";    // narration places player or NPC in wrong location
  severity: "warn" | "block";
  evidence: string;
};
```

### 4. System Prompt

```
You are the player's senses in a simulated world. You do not invent the world — you report it and make it felt.

WHAT YOU CANNOT INVENT: Named NPCs, factions, market prices, commodities, mechanical items, 
distances, or facts about how the world works. These exist in the database. 
You must cite every mechanical entity you reference in citedMechanicalEntities.

WHAT YOU MUST INVENT: The smell of the docks, the heat of the forge, the texture of worn 
cobblestones, the nervous energy of a merchant who won't meet your eyes, ambient sounds, 
weather, how things feel in the hand. This sensory layer is your primary creative contribution.

TOOL USE: Before narrating a scene that involves detailed NPC interaction, market browsing, 
or faction politics, fetch the relevant detail using the provided tools. Do not assume you 
already know it. The world changes between turns.

ACTION: End each turn by calling exactly one action tool. If the player's intent is ambiguous, 
use execute_freeform. Do not guess at typed actions when freeform is more honest.

TIME: Always provide timeMode and a timeElapsed estimate. Travel time is always derived from 
the route — never estimate it yourself.
```

### 5. Validation Fencing

`validateDelta()` rejects:
- Faction resource changes (simulation tick only)
- Location state changes not caused by a typed `SimulationPayload`
- NPC state changes for NPCs not in the current scene
- New information not already in the database (AI cannot create facts)
- Price changes (economy is engine-controlled)
- `timeElapsed` outside TimeMode bounds
- Any entity in `citedMechanicalEntities` that does not exist in the assembled context

---

## Phase 7: Character Depth (Complete Feature)

This is a complete feature. Schema, generation, connection mapping, reputation seeding, and UI are all in scope. A schema-only addition is waste (FM-9).

### 1. Schema

```prisma
model CharacterTemplate {
  // ... all existing fields
  drives       String[] // 1-2 personal objectives independent of any module
  flaws        String[] // 1-2 behavioral tendencies that create friction
  connections  Json     // [{ type: string, description: string, strength: "weak"|"moderate"|"strong" }]
  reputation   Json     // [{ group: string, stance: "trusted"|"neutral"|"suspicious"|"feared" }]
}
```

### 2. Character Generation

`generateCharacter()` generates all four new fields. Prompt guidance:
- Drives are personal and module-agnostic — "defeat the villain" is not a drive, it is a module objective
- Flaws are behavioral tendencies, not mechanical penalties
- Connections are abstract typed relationships — not named individuals, which are mapped at campaign creation
- Reputation references broad social groups, not specific named factions

### 3. Connection Mapping at Campaign Creation

```typescript
async function mapCharacterConnectionsToModule(
  character: CharacterTemplate,
  module: GeneratedModule,
  entryPoint: EntryPoint,
): Promise<CharacterModuleMapping> {
  // "Has an informant in criminal networks"
  // → find Faction of type "criminal", find NPC in that faction
  // → pre-seed that NPC's approval to +2, mark as "known contact"

  // "Owes a significant debt to a guild or institution"
  // → find Faction of type "mercantile" or "religious"
  // → create a pre-existing obligation that surfaces as a specific NPC
  //   who will eventually come collecting (queued as a WorldEvent)

  // "Has a former colleague who turned against them"
  // → find NPC in an opposing faction
  // → mark as having prior history, pre-seed approval to -2
}
```

### 4. Reputation Seeding

During base context assembly, check character reputation groups against present NPCs and the controlling faction. Pre-seed approval values before the first interaction:

```typescript
function seedReputationApproval(
  character: CharacterTemplate,
  presentNpcs: NpcRecord[],
  controllingFaction: Faction | null,
): Map<string, number> {
  // "trusted" by military → +3 approval with any NPC whose faction type is "military"
  // "feared" by criminal → -4 approval with any NPC whose faction type is "criminal"
  // These are initial modifiers, not permanent — relationships still evolve through play
}
```

### 5. Character Builder UI

Required as part of this phase — not deferred:
- Drives: free text with examples shown
- Flaws: structured selector with preset options plus free text
- Connections: structured builder with connection type selector and description field
- Reputation: group selector with preset social groups and stance dropdown

---

## Open Questions (Tracked, Not Deferred)

**Context window budget.** A hard token budget must be established for the base context before Phase 3 ships. Tool fetch responses also consume budget. If the combined base + fetched context exceeds the budget, priority: present NPCs → locally relevant information → market state → faction context → adjacent routes. This must be implemented as hard truncation, not aspirational guidance.

**Multiple sequential day skips.** If the player rests for 3 in-game days, the JIT generator fires 3 times sequentially. Cap at 7 days of sequential generation, then surface a summary. Performance-test this scenario before shipping Phase 4.

**Freeform outcome scope.** The `execute_freeform` tool's `intendedMechanicalOutcome` is player-authored state mutation framed as description. The validation fence must be carefully calibrated — strict enough to prevent AI from hiding typed mutations inside freeform, permissive enough to support genuine creative play. This boundary needs explicit test cases before Phase 6 ships.

**Performance benchmarks.** Before Phase 3 ships, establish baseline query times for base context assembly against a world with 200 NPCs, 500 information nodes, and 15 locations. Target: under 150ms. If exceeded, the indexing strategy needs revision.

**Shared world state.** Multiple players in the same simulation. Not in scope for v1 — the schema is compatible since `userId` on `Campaign` already separates worlds.
