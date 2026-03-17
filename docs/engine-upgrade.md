# Engine Upgrade Path: Sandbox & Slice-of-Life Support (v2)

## Architectural Problem
The current `secretEngine` schema strictly requires a threat-driven narrative via the `villain` object (`motive`, `progressClock`). This prevents open-ended, plotless, or slice-of-life campaigns (e.g., a solarpunk machinist fulfilling commissions). 

Removing the villain entirely without replacing the mechanical tension will cause the LLM to degrade into static, conversational loops with no narrative momentum. The engine must abstract its tension mechanics to drive gameplay without relying on world-ending stakes.

## Implementation Steps

### 1. Abstract "Villain" into "Core Drive"
Replace the antagonist requirement with a generic driver of action.
* **Current Schema:** `villain: { name, motive, progressClock }`
* **Target Schema:** `coreDrive: { type: "threat" | "project" | "mystery" | "milestone", name, description }`
* **Mechanic:** The AI uses the `coreDrive` to frame the consequences of failures and the context of the scene, whether that is a rival guild or a looming project deadline.

### 2. Implement Generic Progress Clocks
Replace the monolithic `villainClock` with an array of multi-purpose clocks (inspired by *Blades in the Dark*).
* **Target Schema:** `clocks: [{ id: string, name: string, currentSegments: number, maxSegments: number, type: "danger" | "progress" | "faction" }]`
* **Mechanic:** The AI proposes advancements to specific clocks during the triage/resolve phase. 
* **Examples:** "Build the perpetual engine (0/8)", "Quarterly rent due (2/4)", "Reputation with Scrapper Guild (3/6)".

### 3. Refactor "Reveals" to "Discoveries"
Generalize the conspiracy mechanics to support mundane or beneficial discoveries.
* **Target Schema:** Rename `hiddenReveals` to `discoveries`.
* **Mechanic:** The underlying `requiredClues` state machine remains unchanged. A slice-of-life character uncovers a new crafting schematic, a hidden city district, or a merchant's secret inventory using the exact same logic currently used to unmask cultists. The AI prompt constraints adjust the tone.

### 4. Transition to Event-Driven Arcs
Move away from linear, pre-generated sequence beats.
* **Mechanic:** Arcs lie dormant until a specific trigger condition is met (e.g., a Clock is filled, or a Discovery is triggered). This allows the narrative to branch organically based on what the player decides to focus on, rather than forcing them down a pre-computed sequence.

## Migration Requirements
This requires overhauling `CampaignBlueprint`, `CampaignState`, the AI triage/resolve prompts, and the UI presentation layer. It must not be attempted until the core rigid loop (Phase 1 & 2) is stable and fully tested.