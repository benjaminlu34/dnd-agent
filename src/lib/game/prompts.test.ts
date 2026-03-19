import assert from "node:assert/strict";
import test from "node:test";
import { auditTurnRenderTool, resolutionTool, triageTool } from "./prompts";

test("DM tool schemas describe free-form scene locations and explicit key anchors", () => {
  const triageDescription = String(
    (triageTool.input_schema.properties.proposedDelta.properties.sceneLocation as { description?: string })
      .description ?? "",
  );
  const resolutionDescription = String(
    (resolutionTool.input_schema.properties.proposedDelta.properties.sceneLocation as {
      description?: string;
    }).description ?? "",
  );
  const keyAnchorDescription = String(
    (triageTool.input_schema.properties.proposedDelta.properties.sceneKeyLocation as {
      description?: string;
    }).description ?? "",
  );

  assert.match(triageDescription, /newly introduced sub-location/i);
  assert.match(resolutionDescription, /newly introduced sub-location/i);
  assert.match(keyAnchorDescription, /exact name of the current campaign anchor/i);
});

test("render auditor tool requires severity, issues, and repairInstructions", () => {
  const required = auditTurnRenderTool.input_schema.required;

  assert.deepEqual(required, ["severity", "issues", "repairInstructions"]);
});
