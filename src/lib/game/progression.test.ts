import assert from "node:assert/strict";
import test from "node:test";
import { deriveProgressionSummary, initializedProgressionState } from "./progression";
import type { ProgressionFramework } from "./types";

const framework: ProgressionFramework = {
  primaryTrackId: "abyssal_assimilation",
  tracks: [
    {
      id: "abyssal_assimilation",
      label: "Abyssal Assimilation",
      summary: "How deeply the abyss has altered the character.",
      min: 0,
      max: 100,
      defaultValue: 5,
      worldStandingScale: [
        {
          minValue: 25,
          effectiveTierLabel: "Early Kindled",
          relativeStanding: "Above ordinary laborers, nearing trained junior delvers.",
        },
        {
          minValue: 0,
          relativeStanding: "Below most trained delvers, but no longer ordinary.",
        },
      ],
    },
  ],
};

test("initializedProgressionState creates default numeric track values", () => {
  assert.deepEqual(initializedProgressionState(framework), {
    trackValues: {
      abyssal_assimilation: 5,
    },
  });
});

test("deriveProgressionSummary exposes compact track and relative-standing context", () => {
  const summary = deriveProgressionSummary({
    framework,
    progression: {
      trackValues: {
        abyssal_assimilation: 30,
      },
    },
  });

  assert.deepEqual(summary, {
    tracks: [
      {
        id: "abyssal_assimilation",
        label: "Abyssal Assimilation",
        value: 30,
        summary: "How deeply the abyss has altered the character.",
      },
    ],
    worldStanding: {
      effectiveTierId: null,
      effectiveTierLabel: "Early Kindled",
      relativeStanding: "Above ordinary laborers, nearing trained junior delvers.",
    },
  });
});
