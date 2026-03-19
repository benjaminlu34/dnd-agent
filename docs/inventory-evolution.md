# Inventory System Evolution Plan

## Current State: Simple String Array Inventory

**How it works today:**
- Inventory is stored as `string[]` in `CharacterInstance`
- Items are acquired only as quest rewards (`rewardItem` field)
- Direct inventory mutations proposed by AI are rejected with warning: "Rejected direct inventory mutation. Inventory remains engine-controlled in v1."
- Inventory is normalized via `normalizeInventory()` to ensure clean string array
- New characters start with empty inventory (`[]`)
- No item properties beyond the string name

**Limitations:**
- No item structure (no description, value, weight, rarity)
- No item usage mechanics (`use_item` intent exists but unimplemented)
- No economic system (shops, prices, haggling)
- No equipment slots or attunement
- No crafting, identification, or container systems
- AI cannot give/take items outside of quest rewards

---

## Phase 1: Basic Structured Inventory System

**Goal:** Replace string inventory with structured items while maintaining reward-only acquisition.

### Changes Required:

1. **Data Model Updates:**
   - Create `ItemTemplate` and `ItemInstance` types (similar to character templates/instances)
   - ItemTemplate: id, name, description, value, weight, rarity, tags
   - ItemInstance: id, templateId, isIdentified, charges, properties
   - Update `CharacterInstance.inventory` from `string[]` to `ItemInstance[]`

2. **Schema Updates:**
   - Prisma schema: Add ItemTemplate and ItemInstance models
   - Migration scripts for existing data
   - Update character instance inventory field to relation

3. **Quest System Updates:**
   - Update `QuestRecord.rewardItem` from `string | null` to `ItemInstance | null`
   - Quest rewards now reference item templates to create instances

4. **Validation Layer Updates:**
   - Modify `validateDelta()` to handle structured item transfers
   - Accept inventory changes only when tied to quest rewards
   - Validate item instance properties during transfer

5. **Engine Updates:**
   - Update `commitValidatedTurn()` to handle ItemInstance arrays
   - Update rollback data to include item instances
   - Ensure proper deep copying for rollback

6. **API Updates:**
   - Update character endpoints to return structured inventory
   - Update serialization/deserialization

7. **Narration Audit Updates:**
   - Update `REPEATED_ITEM_WORDS` to work with item names
   - Ensure key item detection works with structured items

8. **Testing:**
   - Update all affected tests
   - Add tests for item creation, transfer, and normalization

**Outcome of Phase 1:**
- Inventory is array of structured items with basic properties
- Acquisition still quest-reward only
- AI can propose inventory changes but they're still rejected (same restriction)
- Foundation laid for future phases

---

## Phase 2: Expanded Acquisition Methods

**Goal:** Allow item acquisition through means beyond quest rewards while maintaining AI safety.

### 2a: Starter Inventory

**Data model**
- Add `starterItems: string[]` to `CharacterTemplate` (Prisma: `starterItems String[]`).
- No new relation model. Names only at authoring time, same pattern as `rewardItem` strings in Phase 1.
- Cap: maximum 4 starter items per template, enforced in the schema validator and UI.

**Character builder**
- Add a repeater input to `character-builder-app.tsx`: add item name, remove item name, list of strings.
- No template metadata at authoring time — just names.
- Validate max 4 items before save.

**AI character generation**
- Add `starterItems: string[]` (max 4) to `generateCharacterTool` input schema in `provider.ts`.
- Update the generation system prompt to suggest contextually appropriate starting gear based on archetype.
- Normalize and cap the returned array before saving.

**Campaign creation**
- During `createCampaignInTx`, after creating the `CharacterInstance`, iterate `template.starterItems`.
- For each name, create a campaign-local `ItemTemplate` row (same defaults as quest reward templates: `description=null`, `value=0`, `weight=0`, `rarity="common"`, `tags=[]`).
- Create an `ItemInstance` row linking that template to the new `CharacterInstance`.
- No rollback concern — starter items are created once at campaign launch, not during turn commits.

### 2b: Loot Acquisition

**Sources**
- Items found through investigation/search checks (investigative turns).
- Items looted from defeated enemies (combat turns with a failure-or-lower outcome).

**AI proposal**
- Extend `ProposedStateDelta` with `lootDiscoveries: string[]` — item names the AI proposes adding to inventory.
- The AI may only propose loot on investigative turns or turns where an enemy was defeated. The validation layer enforces this; the prompt instructs it.

**Validation**
- `validateDelta` accepts `lootDiscoveries` only when the turn is flagged investigative or the outcome includes a defeat consequence.
- For each accepted name, record `{ name: string }` in a new `acceptedLootDiscoveries: { name: string }[]` field on `ValidatedDelta`.
- Cap accepted loot at 2 items per turn.

**Commit**
- `commitValidatedTurn` creates a campaign-local `ItemTemplate` and `ItemInstance` for each accepted loot discovery, inside the existing transaction.
- Record created instance IDs in `inventoryInstanceIdsAdded` for rollback, same as quest reward items.

**Prompt**
- Add loot instruction block to `buildDungeonMasterSystemPrompt`: the AI may propose `lootDiscoveries` only when the beat resolves a search or a defeat. It must not propose loot on neutral or conversational turns.
- Loot names should be specific and diegetic (not "sword" — "a nicked cavalry sword with a missing crossguard").

**Narration audit**
- No structural changes. Loot items will appear in `PromptContext.inventory` on subsequent turns and benefit from the existing `knownItemNames` audit path automatically.


---

## Phase 3: Full Inventory System

**Goal:** Implement complete D&D-style inventory with equipment, crafting, and advanced mechanics.

### Changes Required:

1. **Equipment System:**
   - Add equipment slots to character (weapon, armor, shield, etc.)
   - Items have slot requirements and attunement rules
   - Equipping/unequipping through structured intents
   - Stat modifiers from equipped items
   - Update validation to handle equipment changes

2. **Crafting System:**
   - Add crafting recipes (requires tools, materials, time)
   - Material components as inventory items
   - Crafting actions through structured intents
   - Validation of recipe requirements
   - Engine-controlled crafting results

3. **Item Properties & Interactions:**
   - Consumables (potions, scrolls) with charges
   - Activatable items (wands, rods)
   - Quest items (cannot be sold/dropped)
   - Cursed items (special handling)
   - Item identification (unknown vs known)

4. **Advanced Economic System:**
   - Shop markup/haggling (charisma-based)
   - Limited shop inventories that refresh
   - Trade goods and art objects
   - Magic item rarity and pricing

5. **Container System:**
   - Bags, pouches, chests as items
   - Nested inventory (items within containers)
   - Weight and capacity limits
   - Quick-access vs stored items

6. **Magic Item System:**
   - Random magic item generation
   - Item attunement limits
   - Charges and recharging
   - Sentient item traits

7. **Structured Intent Expansion:**
   - `equipItem: { itemId: string, slot: string }`
   - `unequipItem: { slot: string }`
   - `craftItem: { recipeId: string, quantity: number }`
   - `identifyItem: { itemId: string }`
   - `attuneItem: { itemId: string }` (if required)
   - `splitStack: { itemId: string, quantity: number }`
   - `combineStacks: { itemId1: string, itemId2: string }`

8. **Validation Updates:**
   - Validate equipment slot availability
   - Validate attunement limits and compatibility
   - Validate crafting requirements (skills, materials, time)
   - Validate item interactions (consume, activate, etc.)
   - Validate container capacity and nesting

9. **Engine Updates:**
   - Track equipped items separately from inventory
   - Apply equipment stat modifiers to character
   - Handle item activation effects
   - Manage crafting queues and completion
   - Track attunement and charges

10. **Narration Audit Updates:**
    - Track equipped items as "key items" when relevant
    - Monitor for item overuse (daily limits on consumables)
    - Ensure magic item descriptions match rarity
    - Audit for economically implausible transactions

**Outcome of Phase 3:**
- Full D&D-style inventory management
- AI can propose rich item interactions within validated bounds
- Deep character customization through gear
- Meaningful economic choices
- All changes remain engine-controlled and validated

---

## Implementation Approach

### Risk Mitigation Strategies:

1. **Backward Compatibility:**
   - Each phase maintains API compatibility where possible
   - Migration scripts convert string[] to ItemInstance[]
   - Default items created for existing string inventory

2. **Gradual Rollout:**
   - Feature flags for new inventory mechanics
   - Enable phases per-campaign or per-module
   - Allow testing with existing content first

3. **AI Safety Preservation:**
   - Keep validation layer as gatekeeper for all changes
   - AI never directly manipulates state
   - All proposals validated against current game state
   - Narration audit continues to prevent overuse/misuse

4. **Performance Considerations:**
   - Index database queries for item lookups
   - Cache frequently accessed item templates
   - Limit nested container depth for performance
   - Batch inventory updates where possible

### Technical Implementation Details:

**Database Schema Changes:**
```prisma
model ItemTemplate {
  id        String   @id @default(uuid())
  userId    String
  name      String
  description String?
  value     Int      @default(0)
  weight    Float    @default(0.0)
  rarity    String   @default("common")
  tags      String[]
  ItemInstance ItemInstance[]
  @@index([userId])
}

model ItemInstance {
  id          String   @id @default(uuid())
  templateId  String
  characterId String   @unique
  template    ItemTemplate @relation(fields: [templateId], references: [id])
  character   CharacterInstance @relation(fields: [characterId], references: [id])
  isIdentified Boolean @default(false)
  charges     Int?      // For consumables
  properties  Json?     // Flexible property bag
  @@index([templateId])
  @@index([characterId])
}

model CharacterInstance {
  // ... existing fields
  inventory   ItemInstance[] @relation("CharacterInventory")
  // Or alternatively: inventoryId String @unique and Inventory model
}
```

**Validation Flow:**
1. AI proposes delta with inventory changes
2. Validation layer checks:
   - Source of items (quest reward, loot table, player gold, etc.)
   - Legality of transaction (affordability, availability, etc.)
   - Item validity (exists in template, not duplicated improperly)
3. If valid, accepts changes; if invalid, rejects with warning
4. Engine applies only validated changes

**API Endpoints:**
- GET `/api/characters/[id]/inventory` - Get structured inventory
- POST `/api/characters/[id]/inventory/purchase` - Buy items (validated)
- POST `/api/characters/[id]/inventory/sell` - Sell items (validated)
- POST `/api/characters/[id]/inventory/loot` - Add loot (engine-only, for internal use)

---

## Success Criteria

**Phase 1 Complete When:**
- All character instances have `ItemInstance[]` inventory
- Quest rewards properly create and assign item instances
- Existing tests pass with updated inventory structure
- Narration audit works with item names
- No regression in core game loop

**Phase 2 Complete When:**
- Character templates can define up to 4 starter items
- New campaigns materialize starter items as `ItemTemplate` and `ItemInstance` rows
- Characters can acquire items through validated loot discoveries
- AI can propose `lootDiscoveries` that are properly validated
- No duplication or loss of items during starter-item or loot-item creation and rollback

**Phase 3 Complete When:**
- Equipment system provides stat bonuses
- Crafting system produces items from recipes
- Container system supports nested storage
- Magic items have appropriate rarity and effects
- Full economic system functions (buying, selling, haggling)
- All structured intents for item actions work correctly


---

## Conclusion

The current game engine has sufficient architectural maturity to begin evolving the inventory system. The separation of template/instance data, existing validation layer, structured action intents, and narration audit systems provide a strong foundation.

By progressing through these three phases—starting with structured items while maintaining reward-only acquisition, then expanding acquisition methods safely, and finally implementing full D&D-style inventory mechanics—we can evolve the system without compromising the AI-mediated safety and predictability that makes this engine unique.

Each phase delivers tangible value while building toward the ultimate goal of a rich, D&D-like inventory experience that remains under engine control and validated against game state.
