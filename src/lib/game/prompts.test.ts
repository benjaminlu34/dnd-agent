import assert from "node:assert/strict";
import test from "node:test";
import { auditTurnRenderTool, resolutionTool, triageTool } from "./prompts";

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

test("render auditor tool requires severity, issues, and repairInstructions", () => {
  const required = auditTurnRenderTool.input_schema.required;

  assert.deepEqual(required, ["severity", "issues", "repairInstructions"]);
});
