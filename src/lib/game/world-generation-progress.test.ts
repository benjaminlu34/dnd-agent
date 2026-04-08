import assert from "node:assert/strict";
import test from "node:test";
import {
  beginDraftGenerationProgress,
  getDraftGenerationProgress,
  isDraftGenerationStopRequested,
  requestDraftGenerationStop,
  stopDraftGenerationProgress,
} from "./world-generation-progress";

test("draft generation stop requests are reflected in progress state", () => {
  const id = `progress-stop-${crypto.randomUUID()}`;

  beginDraftGenerationProgress(id);
  const requested = requestDraftGenerationStop(id);

  assert.equal(isDraftGenerationStopRequested(id), true);
  assert.equal(requested?.stopRequested, true);
  assert.equal(requested?.label, "Stopping Generation");
  assert.match(requested?.message ?? "", /current model response finishes/i);
});

test("stopping draft generation clears the stop token and leaves a resumable stopped state", () => {
  const id = `progress-stopped-${crypto.randomUUID()}`;

  beginDraftGenerationProgress(id);
  requestDraftGenerationStop(id);
  const stopped = stopDraftGenerationProgress(id);

  assert.equal(isDraftGenerationStopRequested(id), false);
  assert.equal(stopped?.status, "stopped");
  assert.equal(stopped?.stopRequested, false);
  assert.match(stopped?.message ?? "", /resume from the latest checkpoint/i);
});

test("beginDraftGenerationProgress clears prior stop requests when resuming", () => {
  const id = `progress-resume-${crypto.randomUUID()}`;

  beginDraftGenerationProgress(id);
  requestDraftGenerationStop(id);
  beginDraftGenerationProgress(id);

  const resumed = getDraftGenerationProgress(id);
  assert.equal(isDraftGenerationStopRequested(id), false);
  assert.equal(resumed?.status, "queued");
  assert.equal(resumed?.stopRequested, false);
  assert.equal(resumed?.label, "Resuming Your Draft");
});
