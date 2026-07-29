import type { TaskStatus } from "./types.js";

export const taskTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  inbox: ["planned", "queued", "cancelled"],
  planned: ["queued", "cancelled", "blocked"],
  queued: ["in_progress", "cancelled", "blocked", "failed"],
  in_progress: ["review", "awaiting_approval", "done", "blocked", "failed"],
  review: ["planned", "in_progress", "awaiting_approval", "done", "cancelled", "blocked", "failed"],
  awaiting_approval: ["in_progress", "done", "cancelled", "blocked"],
  blocked: ["planned", "queued", "in_progress", "cancelled", "failed"],
  failed: ["queued", "cancelled"],
  done: [],
  cancelled: []
};

export function canTransitionTask(from: TaskStatus, to: TaskStatus): boolean {
  return taskTransitions[from].includes(to);
}

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!canTransitionTask(from, to)) {
    throw new Error(`Invalid task transition: ${from} -> ${to}`);
  }
}
