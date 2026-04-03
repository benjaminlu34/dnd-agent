# Scale-Aware, Player-Agnostic World Generation Refactor

## Summary
Refactor world generation so module creation is:
- explicitly scale-aware: `settlement | regional | world`
- fully player-agnostic and reusable
- launchable directly only for `settlement` and `regional` in this pass
- ready for later recursive descent without requiring another schema rethink

Current architectural corrections:
- stop using one world-bible contract for all scales
- stop baking character/player perspective into reusable modules
- stop generating entry contexts during module creation
- preserve legacy modules/artifacts cleanly

## Key Changes

### 1. Add explicit scale selection and durable launch status
Add `scaleTier` to draft generation input and persist it in artifacts.

New artifact fields:
- `scaleTier: "settlement" | "regional" | "world"`
- `scalePlan`:
  - `entryScale`
  - `worldBibleScale`
  - `worldSpineScale`
  - `regionalLifeScale`
  - `socialCastScale`
  - `knowledgeScale`
  - `expectsChildDescent: boolean`
  - `launchableDirectly: boolean`
  - `launchBlockReason: "none" | "requires_world_descent" | "requires_region_materialization"`

Rules:
- `settlement` and `regional`:
  - `launchableDirectly = true`
  - `launchBlockReason = "none"`
- `world` in this pass:
  - `launchableDirectly = false`
  - `launchBlockReason = "requires_world_descent"`

This preserves a clean upgrade path later:
- when recursive descent exists, `world` modules can move from `requires_world_descent` to `requires_region_materialization`, then to `none` after a concrete entry region exists

Public/API changes:
- `campaignDraftRequestSchema` requires `scaleTier`
- session-zero draft UI adds explicit scale selection
- module detail/summary payloads expose scale metadata for review/debugging

Legacy default:
- missing `scaleTier` parses as `regional`
- missing `launchBlockReason` defaults from `scaleTier`

### 2. Remove player/protagonist assumptions from module generation
Module generation must only produce objective world facts.

Prompt framing changes:
- remove “solo player,” “player,” and “for the player to navigate” language from all worldgen prompts
- replace with simulation/objective world framing

Schema/content changes:
- replace `playerCrossPath` with `publicContactSurface`
- define `publicContactSurface` as:
  - the mundane bureaucratic, commercial, ritual, or infrastructural interface where the public encounters this NPC
  - examples: toll booth, permit line, shrine queue, ration counter, registry desk, customs gate, market stall, dock ledger station
- remove `entry_contexts` from:
  - generation pipeline
  - generation artifacts
  - module draft assembly

Required compatibility changes:
- `GeneratedWorldModule.entryPoints` becomes optional with `.default([])` at parse time
- `openWorldGenerationArtifactsSchema.entryContexts` becomes optional
- existing stored modules/artifacts with entry points/entry contexts continue to parse
- newly generated modules should not depend on baked entry points

Launch/campaign layer:
- `ResolvedLaunchEntry` stays a campaign-time concept only
- opening generation combines:
  - module
  - chosen character/template
  - optional user launch prompt

### 3. Keep current world-bible keys, but make semantics scale-aware
Keep canonical keys:
- `groundLevelReality`
- `widespreadBurdens`
- `presentScars`
- `sharedRealities`

Do not rename again in this pass.

Scale-specific semantics:

Settlement:
- `groundLevelReality`: objective street/neighborhood/material truth
- `widespreadBurdens`: local chokepoints, fees, ward pressure, repairs, permits, inspections
- `presentScars`: visible city/local scars
- `sharedRealities`: recurring local habits, signage, smells, money, queues, rites

Regional:
- `groundLevelReality`: border/route/territory reality
- `widespreadBurdens`: checkpoints, monopolies, weather exposure, route pressure, territorial friction
- `presentScars`: burned roads, dead canals, treaty scars, old wars, ruined crossings
- `sharedRealities`: systems and habits repeated across towns/frontiers

World:
- `groundLevelReality`: objective civilizational/material truth proven through shared systems, not outsider narration
- `widespreadBurdens`: civilizational frictions manifesting across cultures
- `presentScars`: world-scale fractures with present physical evidence
- `sharedRealities`: connective tissue shared across major civilizations, ports, currencies, rituals, hazards, or infrastructures

Prompt rules:
- hard anti-pattern: do not enumerate all geography/subregions in the world bible
- hard anti-pattern: do not write burdens/scars as plot hooks waiting for a hero
- `groundLevelReality` must be objective sensory/material truth, not arrival framing
- add the anti-pattern to truncation-retry correction notes too, so retries do not satisfy counts by listing subregions

### 4. Lower static schema floors and enforce scale-specific floors dynamically
Lower hardcoded Zod floors to the smallest supported container.

Recommended new static floors:
- `widespreadBurdens.min(3)`
- `presentScars.min(3)`
- `sharedRealities.min(3)`
- keep institutions/fears/wants/trade/gossip at low reusable floors appropriate for settlement scale

Do not rely on prompt text alone for larger scales.

Add dynamic validation inside the world-bible stage after parse:
- compute expected minimums from `scaleTier`
- if parsed counts miss the scale-specific floor, return validation issues and retry

Recommended dynamic floors:
- `settlement`
  - burdens: 3
  - scars: 3
  - shared realities: 4
- `regional`
  - burdens: 5
  - scars: 4
  - shared realities: 5
- `world`
  - burdens: 5
  - scars: 5
  - shared realities: 5

Important policy:
- world scale does not mean “highest count”
- world scale means stricter connective-tissue quality, less local bleed, more systemic coherence

### 5. Introduce a real ScaleProfile with enforceable forbidden detail levels
Each stage receives a `ScaleProfile` object used both in artifacts and prompt construction.

`ScaleProfile`:
- `sourceScale: "settlement" | "regional" | "world"`
- `targetSemanticScale: "local" | "regional" | "civilizational"`
- `detailMode: "street_level" | "territorial" | "civilizational"`
- `forbiddenDetailModes: ForbiddenDetailMode[]`
- `launchableOutput: boolean`
- `expectsChildDescent: boolean`

`ForbiddenDetailMode` enum:
- `"single_room"`
- `"single_business"`
- `"single_street_address"`
- `"micro_neighborhood"`
- `"full_geographic_enumeration"`
- `"cosmological_abstraction"`

Required behavior:
- prompts must explicitly say what the stage is allowed to name and what it must not name based on `forbiddenDetailModes`
- this is not metadata-only; it must alter stage instructions and validation

Examples:
- `world_bible` at `world`:
  - forbidden: `single_business`, `single_street_address`, `micro_neighborhood`, `full_geographic_enumeration`
- `social_cast` at `world`:
  - forbidden: `single_room`, `single_business`, `single_street_address`

### 6. Make downstream stages scale-aware
Keep the flat pipeline in this pass, but reinterpret each stage by scale.

`world_spine`
- settlement: districts, hubs, chokepoints, hazards
- regional: cities, frontier points, strongholds, routes
- world: regions, civilizations, frontier expanses, oceanic/cosmic corridors

`regional_life`
- settlement: district and civic life
- regional: route/territory public life
- world: region-level translation of world burdens/scars into lived public conditions

`social_cast`
- settlement/regional: ordinary anchored locals, but objective
- world: region/civilization-facing actors only

Required world-scale prompt guard:
- “Locations represent entire regions or civilizations. Assign NPCs to those macro locations only. Do not invent taverns, rooms, alleys, shops, or unmapped addresses.”

Required world-scale validation:
- post-parse validation that each NPC `currentLocationId` references one of the generated world-spine nodes
- world-scale social validation must reject any NPC output whose description or public contact surface implies a micro-address not represented in the spine
- world-scale world-spine validation must reject obviously micro-geographic location naming/summary drift

World-spine macro validation at `world` scale:
- add critique/validation that world-spine locations must read as macro-geography or macro-polities, not taverns/streets/single buildings
- enforce this through stage validation, not just prompt text

### 7. Update downstream projections for the new objective NPC surface
Wherever social-layer summaries feed other stages, include `publicContactSurface`.

Reason:
- knowledge/economy stages need to know where an NPC touches public systems
- this replaces the grounding previously implied by `playerCrossPath`

Required updates:
- social-layer stored artifacts include `publicContactSurface`
- any summarizer/projection that currently feeds NPC accessibility into later stages must include it

### 8. Defer direct launch of world-scale modules with a structured error
In this pass:
- `world`-scale modules are reusable skeletons only
- they cannot be launched directly yet

Backend behavior:
- campaign creation / launch must explicitly inspect module `scaleTier` / `launchBlockReason`
- reject world-scale launch with structured error:
  - `code: "MODULE_REQUIRES_DESCENT"`
  - `message: "World-scale modules require region materialization before launch. This feature is pending."`

Frontend behavior:
- disable or gate launch affordances for world-scale modules
- show the structured reason, not a generic failure

This is explicit product behavior, not an accidental 500.

## Test Plan
- draft request schema requires `scaleTier`
- legacy artifacts/modules without `scaleTier` still parse as `regional`
- legacy modules/artifacts with `entryPoints` / `entryContexts` still parse
- newly generated modules/artifacts can omit them cleanly
- shared worldgen prompts no longer mention `solo player` / protagonist framing
- `generatedSocialNpcSchema` contains `publicContactSurface` and not `playerCrossPath`
- social/economy/knowledge projections include `publicContactSurface`
- lowered static schema floors accept settlement-scale outputs
- dynamic validation retries when scale-specific minimums are missed
- settlement-scale bible accepts local dense texture
- regional-scale bible accepts route/territory texture
- world-scale bible accepts systemic/connective-tissue texture
- critique flags plot-hook language in `widespreadBurdens` / `presentScars`
- critique flags local-detail bleed at world scale
- world-scale `social_cast` rejects micro-address drift
- world-scale `world_spine` rejects tavern/street/building-style naming
- campaign launch returns `MODULE_REQUIRES_DESCENT` for world-scale modules
- settlement/regional modules remain directly launchable

## Opinions / Decisions
- Agree: Zod floors must be lowered; bigger floors belong in dynamic validation, not static schema.
- Agree: `publicContactSurface` needs a strict public-system definition.
- Agree: `forbiddenDetailMode` needs a small enum, not an open string.
- Agree: world-scale social anchoring needs hard validation, not prompt-only enforcement.
- Agree: direct world launch must fail with a structured contract, not a generic server error.
- Agree: local-detail bleed at world scale deserves an explicit critique/validation test.
- Agree: truncation retry logic must preserve the “no geographic enumeration” anti-pattern.
- Disagree: another schema rename is not necessary in this pass.
- Disagree: macro `groundLevelReality` should not become outsider historian voice; it should stay objective and materially grounded.
- Deferred intentionally: recursive region materialization / descent.

## Assumptions
- campaign and character instance data are disposable
- campaign modules are non-disposable and must preserve parse compatibility
- first pass goal is scale-aware architecture plus player/objective decoupling, not recursive descent
- world-scale modules being non-launchable in this pass is acceptable if clearly surfaced in API/UI
