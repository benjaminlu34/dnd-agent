import assert from "node:assert/strict";
import test from "node:test";
import { renderWhatChanged, renderWhy } from "./causality";

test("renderWhatChanged translates structured change codes into specific UI copy", () => {
  assert.deepEqual(
    renderWhatChanged([
      {
        code: "LOCATION_CHANGED",
        entityType: "location",
        targetId: "loc_market",
        metadata: { label: "Lantern Market" },
      },
      {
        code: "SCHEDULE_JOB_ENQUEUED",
        entityType: "schedule_job",
        targetId: "day_3",
        metadata: { label: "Day 3" },
      },
    ]),
    [
      "You moved to Lantern Market.",
      "Future schedule generation was queued for Day 3.",
    ],
  );
});

test("renderWhy translates structured reason codes into readable causality copy", () => {
  assert.deepEqual(
    renderWhy([
      {
        code: "PLAYER_SCENE_INTERACTION",
        entityType: "npc",
        targetId: "npc_mara",
        metadata: { label: "Mara Thistle" },
      },
      {
        code: "PLAYER_INVESTIGATION",
        entityType: "information",
        targetId: "info_1",
        metadata: null,
      },
      {
        code: "HORIZON_CAP",
        entityType: "campaign",
        targetId: "camp_1",
        minutes: 90,
        metadata: null,
      },
    ]),
    [
      "Because you approached and engaged with the scene.",
      "Because you investigated further.",
      "Because time could only advance inside the committed schedule window.",
    ],
  );
});
