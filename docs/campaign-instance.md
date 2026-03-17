# Engine Upgrade Path: Replayable Modules (v3)

## Architectural Problem
Currently, AI-generated `CampaignBlueprint` data is baked directly into the `Campaign` database row. This means a generated premise/world can only be played once. If a user rolls a fantastic setting and wants to replay it with a different character class, they cannot do so without the AI hallucinating a brand new (and inevitably different) draft.

## The "Module" Solution
Apply the Template/Instance pattern to campaigns.

### 1. New Model: `AdventureModule`
Extract the immutable blueprint data into a parent table.
* `id`, `userId`
* `title`, `publicSynopsis` (Json)
* `secretEngine` (Json)

### 2. Refactor Model: `Campaign`
The `Campaign` becomes strictly the mutable "Save File" for a specific playthrough.
* Remove: `title`, `premise`, `tone`, `setting`, `blueprint`
* Add: `moduleId` (Relation to `AdventureModule`)
* Retain: `templateId` (The PC), `stateJson`, `status`
* Retain Relations: `Sessions`, `Arcs`, `Quests`, `NPCs`, `Clues`

### 3. UX Flow Update
Session Zero becomes a three-step process:
1. **The Library:** User views their saved `AdventureModules` and `CharacterTemplates`.
2. **The Generator:** User can draft a new `AdventureModule` (using the progressive disclosure UI).
3. **The Launch:** User pairs one `AdventureModule` with one `CharacterTemplate` to spawn a new `Campaign` playthrough.