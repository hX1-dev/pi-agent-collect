import assert from "node:assert/strict";
import test from "node:test";
import { assertTaskTransition, canTransitionTask } from "./workflow.js";

test("allows a task to enter execution from the queue", () => {
  assert.equal(canTransitionTask("queued", "in_progress"), true);
});

test("prevents completed tasks from silently restarting", () => {
  assert.equal(canTransitionTask("done", "in_progress"), false);
  assert.throws(() => assertTaskTransition("done", "in_progress"));
});

test("allows the board to reject work that is in review", () => {
  assert.equal(canTransitionTask("review", "cancelled"), true);
});
