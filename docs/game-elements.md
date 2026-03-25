1. Database Schema Overhaul
Your current schema uses generic JSON properties and abstract states. You must add explicit mechanical fields.

Character & NPC Updates:

Add level (Int, default 1) and experience (Int, default 0) to CharacterInstance.

Add armorClass (Int) to CharacterInstance and CharacterTemplate.

Replace the abstract state and threatLevel in NPC with explicit currentHealth (Int), maxHealth (Int), armorClass (Int), and attackBonus (Int).

Equipment & Item Updates:

Modify ItemInstance to include an isEquipped (Boolean, default false) field.

Modify ItemTemplate to replace the generic tags or properties with explicit combat fields: equipmentSlot (String: "main_hand", "armor", "accessory"), weaponDamage (String: e.g., "1d8"), weaponStat (String: "strength", "dexterity"), and armorBonus (Int).

2. The Combat Execution Loop
You must rewrite applyCombatEffects in engine.ts. The LLM will no longer provide the CheckResult for combat.

The new loop:

Intent Parsing: The player inputs an action ("I swing my iron longsword at the goblin").

Tool Call: The LLM outputs an ExecuteCombatToolCall specifying the targetNpcId and the approach.

Backend Calculation (The Core Change): * The backend retrieves the player's CharacterInstance, specifically looking at their equipped weapon and relevant stat modifier.

The backend retrieves the target NPC's armorClass.

The backend rolls a simulated d20, adds the stat modifier and a proficiency bonus (derived from the new level field).

If the total meets or exceeds the NPC's AC, the backend parses the weapon's weaponDamage string (e.g., rolling a d8), adds modifiers, and subtracts that value from the NPC's currentHealth.

State Mutation: If the NPC's currentHealth reaches 0, the backend updates its state to "dead".

Forced Narration: The backend generates a strict JSON payload representing this outcome (e.g., { "hit": true, "damage": 6, "targetState": "wounded" }) and feeds this back to the LLM in a secondary prompt, instructing the LLM to narrate this specific outcome without hallucinating alternate results.

3. Experience and Levelling
You must build an XP distribution and levelling mechanism.

In engine.ts, when an NPC's health reaches 0 during applyCombatEffects, calculate an XP reward based on the NPC's base stats.

Add this XP to the CharacterInstance.

At the end of the commitResolvedTurn function, evaluate if experience exceeds the threshold for the next level. If so, increment the level and trigger a level-up routine (e.g., increasing maxHealth and allowing stat allocation).