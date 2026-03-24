# Custom Entry Point Scope

## Problem

Campaign creation currently allows the player to choose from three generated entry points, but not to define a custom way to enter the world.

That is a meaningful limitation because the entry point is not cosmetic. It determines:

- starting location
- present NPCs
- initial discovered information
- opening pressure and tone
- the first authored scene

So a custom entry point is a full feature, not a small UI add-on.

## Current State

The current system assumes:

- world generation returns exactly three entry points
- the launch UI selects one existing `entryPointId`
- opening draft generation requires an existing `entryPointId`
- campaign creation persists `selectedEntryPointId`

This means there is no supported path for:

- "I arrive as a smuggler with a forged pass"
- "I start already hiding from a faction patrol"
- "I enter through the market during a riot"

unless one of the generated openings happens to match.

## Goal

Let the player provide a custom desired opening and have the system convert it into a valid, world-grounded entry point that can be previewed, drafted, and launched like any generated opening.

The feature should preserve the project’s current authority rules:

- the player expresses intent and tone
- the engine and validation layer enforce world consistency
- the model authors prose and fitting specifics
- the resulting starting state remains canonical and structurally valid

## Non-Goals

- letting the player arbitrarily create new locations, NPCs, factions, or lore outside world constraints
- bypassing validation for opening-state legality
- adding deterministic fallback opening generation
- preserving backwards compatibility for old campaign drafts if that adds complexity

## Product Shape

### Player Experience

During campaign launch, the player can either:

1. choose one of the three generated entry points
2. write a custom entry request

Example prompt:

> I want to enter the city quietly at dawn, pretending to be a courier while trying to avoid attention from the watch.

The system then produces a validated custom opening candidate with:

- chosen start location
- present NPCs
- initial known information
- immediate pressure
- opening narration draft

The player can regenerate that draft, edit their prompt, or launch with it.

### Key Constraint

The player is customizing the *approach into the world*, not defining raw world facts.

That means the system may reinterpret the request into something the world can actually support. For example:

- the player asks to enter by ship, but the world has no practical harbor start
- the system grounds that intent into the nearest plausible dock, ferry landing, or black-market river access

## Core Requirements

### 1. World-Grounded, Not Freeform Canon Injection

The custom entry flow must only use:

- existing locations
- existing NPCs
- existing information
- existing factions

It may reframe these, but it must not invent unsupported canon during launch.

### 2. Same Validation Bar As Generated Entry Points

A custom entry point must satisfy the same structural rules as generated ones:

- valid `startLocationId`
- valid `presentNpcIds`
- valid `initialInformationIds`
- reachable opening geography
- enough immediate pressure / public lead / mundane action path

### 3. Same Launch Semantics As Standard Entry Points

Once accepted, a custom entry point should behave like a normal one:

- opening draft generation uses it
- campaign creation uses it
- `selectedEntryPointId` or equivalent canonical selection still points to a real launchable artifact

### 4. AI-Authored Opening Prose Remains Default

The player supplies intent, not final narration.

The model should still write:

- opening narration
- scene title / atmosphere
- immediate threat wording
- suggested actions

## Recommended Design

## Two-Layer Model

Represent custom entry as two separate things:

### A. Player Intent

A freeform request such as:

- desired vibe
- desired approach
- desired concealment / social posture
- desired urgency
- desired first problem

This is not canonical world data.

### B. Resolved Entry Artifact

A validated, concrete, canonical entry artifact derived from that intent:

- `id`
- `title`
- `summary`
- `startLocationId`
- `presentNpcIds`
- `initialInformationIds`
- `immediatePressure`
- `publicLead`
- `mundaneActionPath`
- optional metadata like `isCustom: true` and `customIntentSummary`

This resolved artifact is what the rest of the system should consume.

That keeps the existing launch pipeline intact while making the custom step explicit.

## Suggested Flow

1. Player selects "Custom Entry"
2. Player writes a short request
3. Backend resolves that request against the generated world
4. Validation checks the resolved artifact
5. Opening draft generation uses the resolved artifact
6. Player launches campaign from that validated custom entry

## Architecture Impact

### UI

Add a fourth option in campaign creation:

- three generated entry cards
- one "Custom Entry" path with a text box

Needed behavior:

- switch between preset entry selection and custom entry mode
- preview the resolved custom entry before launch
- regenerate custom resolution without regenerating the whole world
- preserve custom input while iterating on opening draft text

### API

Likely add a custom-entry resolution endpoint, separate from final campaign creation.

Example:

`POST /api/campaigns/custom-entry`

Request:

```json
{
  "moduleId": "mod_123",
  "templateId": "tpl_123",
  "prompt": "I want to enter quietly as a courier at dawn."
}
```

Response:

```json
{
  "entryPoint": {
    "id": "custom_entry_1",
    "title": "Courier at First Light",
    "summary": "You slip in with the dawn trade under borrowed authority.",
    "startLocationId": "loc_gate",
    "presentNpcIds": ["npc_gate_clerk", "npc_patrol_sergeant"],
    "initialInformationIds": ["info_gate_tension"],
    "immediatePressure": "Gate inspections are tightening by the minute.",
    "publicLead": "A clerk is quietly waving known couriers through.",
    "mundaneActionPath": "Join the inspection line and play your role.",
    "isCustom": true,
    "customIntentSummary": "Quiet dawn entry using a courier cover."
  }
}
```

Then opening generation can continue to use the resolved artifact instead of requiring only a built-in entry id.

### Data Model

There are two viable paths.

#### Option A: Persist custom entry points into the module draft before launch

Pros:

- simpler downstream compatibility
- existing `entryPointId` flow remains mostly intact

Cons:

- mutates generated module data for a player-local launch preference
- blurs authored world structure with launch-time customization

#### Option B: Persist custom resolved entry only at campaign-launch scope

Pros:

- cleaner separation between world definition and player-specific launch choice
- avoids polluting the module with per-player openings

Cons:

- campaign creation path needs to accept a resolved entry artifact, not just `entryPointId`

Recommendation: Option B.

The custom entry is a launch-time resolved overlay, not part of the world bible itself.

## Validation Rules

The custom resolver should be strict about what it is allowed to do.

### Must Validate

- selected location exists
- every present NPC exists and is plausible at that location
- every initial information id exists and is accessible enough for an opening
- the opening has an immediate pressure
- the opening has at least one mundane path forward
- the opening has at least one visible lead into active play

### Must Reject or Repair

- requests that require unsupported world facts
- requests that imply impossible geography
- requests that depend on dead / invalid / unreachable entities
- requests that produce isolated openings with no nearby play surface

### Preferred Behavior

Try to repair invalid custom prompts into the nearest valid version when possible, and only reject when no honest grounding exists.

## Opening Draft Integration

The opening-draft generator should accept either:

- a stock generated entry point
- a resolved custom entry artifact

That suggests introducing a shared "launch entry context" type rather than branching the whole pipeline.

## Risks

### 1. Canon Leakage

If the resolver is too permissive, it may smuggle in world facts the player has not discovered.

Mitigation:

- custom entry resolution may reference existing hidden facts internally for fit
- but player-facing output should only expose what is valid for an opening scene

### 2. False Agency

If the player writes a very specific opening and the system quietly transforms it into something loosely related, it may feel deceptive.

Mitigation:

- preview the resolved entry clearly
- show the grounded title / summary before launch
- make the transformation legible rather than invisible

### 3. Pipeline Duplication

If custom-entry launch uses separate draft / create logic, the feature will become brittle.

Mitigation:

- normalize both preset and custom entry into one resolved launch-entry shape

### 4. Validation Friction

If custom prompts fail too often, the feature will feel broken.

Mitigation:

- prefer "repair into valid" over hard rejection
- keep the prompt box framed as intent, not absolute authoring

## Suggested Implementation Plan

### Phase 1: Scope-Level Support

- add custom-entry UI mode
- add backend resolver from freeform intent to resolved entry artifact
- validate artifact against current world
- allow opening draft preview using resolved custom entry
- do not yet persist reusable custom entries anywhere beyond the launch flow

### Phase 2: Launch Integration

- update campaign creation to accept either `entryPointId` or `resolvedEntryPoint`
- create campaign using the resolved artifact as the canonical opening basis
- keep resulting campaign snapshot semantics unchanged

### Phase 3: UX Hardening

- better repair explanations
- regenerate custom resolution independently from draft prose
- optionally expose "why this was chosen" in a subtle debug panel

## Open Questions

- Should custom entry be available only at campaign creation, or also as a "restart opening" tool in QA flows?
- Should the player be allowed to pin one or two hard constraints, such as exact start location?
- Should resolved custom entries receive stable ids, or be treated as ephemeral launch artifacts?
- Should the opening-draft regeneration reuse the same resolved custom artifact by default, or allow re-resolution every time?

## Recommendation

Build this as a first-class launch feature with a resolved-entry layer, not as a patch on top of the current three-card selector.

The cleanest shape is:

- player writes custom intent
- backend resolves that intent into a validated entry artifact
- the rest of the pipeline treats that artifact exactly like a normal entry point

That preserves the authority model, keeps the world grounded, and avoids forking campaign creation into two unrelated systems.
