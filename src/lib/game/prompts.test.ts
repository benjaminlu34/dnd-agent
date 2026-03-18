import assert from "node:assert/strict";
import test from "node:test";
import { resolutionTool, triageTool } from "./prompts";

test("DM tool schemas require exact established sceneLocation names", () => {
  const triageDescription = String(
    (triageTool.input_schema.properties.proposedDelta.properties.sceneLocation as { description?: string })
      .description ?? "",
  );
  const resolutionDescription = String(
    (resolutionTool.input_schema.properties.proposedDelta.properties.sceneLocation as {
      description?: string;
    }).description ?? "",
  );

  assert.match(triageDescription, /Must match previously established location names exactly/i);
  assert.match(resolutionDescription, /Must match previously established location names exactly/i);
});
