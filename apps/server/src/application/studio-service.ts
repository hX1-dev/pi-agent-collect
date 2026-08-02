import type {
  Studio,
  StudioHealth,
  StudioHeartbeatReport,
  StudioInstance,
  StudioOperationalSnapshot
} from "@private-ai-org/core";

export interface StudioRepositoryPort {
  listStudios(): Studio[];
  getStudio(studioId: string): Studio;
  createStudio(input: {
    id?: string;
    key: string;
    name: string;
    purpose: string;
    managerAgentId: string;
    sortOrder?: number;
  }): Studio;
  transitionStudio(studioId: string, status: Studio["status"]): Studio;
  listStudioInstances(studioId: string): StudioInstance[];
  getStudioHealth(studioId: string, observedAt?: string): StudioHealth;
  createStudioInstance(input: {
    id?: string;
    studioId: string;
    vmProviderInstanceId?: string | null;
    replaceCurrent?: boolean;
  }): StudioInstance;
  recordStudioHeartbeat(input: {
    studioId: string;
    instanceId: string;
    report: StudioHeartbeatReport;
  }): { instance: StudioInstance; health: StudioHealth; replayed: boolean };
  observeOfflineStudioInstances(observedAt: string): StudioInstance[];
}

/**
 * Durable identity changes must not invalidate the Studio instance that owns
 * an unresolved VM lifecycle operation. The repository raises this signal
 * while holding its write transaction so HTTP callers receive a stable,
 * path-free conflict instead of attempting to bypass the pending operation.
 */
export class StudioVmOperationInProgressError extends Error {
  readonly code = "STUDIO_VM_OPERATION_IN_PROGRESS" as const;

  constructor() {
    super("A pending VM lifecycle operation must finish before this Studio identity can change");
    this.name = "StudioVmOperationInProgressError";
  }
}

export const PERSONAL_STUDIO_BLUEPRINTS = [
  {
    id: "studio-github-research",
    key: "github-research",
    name: "GitHub Research & Experience",
    purpose: "Discover, isolate, run, and verify noteworthy GitHub projects with editor-ready evidence.",
    managerAgentId: "agent-kai",
    sortOrder: 1
  },
  {
    id: "studio-content-marketing",
    key: "content-marketing",
    name: "Content & Marketing",
    purpose: "Turn verified evidence into grounded positioning, scripts, captions, and shot plans.",
    managerAgentId: "agent-mira",
    sortOrder: 2
  },
  {
    id: "studio-video-production",
    key: "video-production",
    name: "OpenMontage Video Production",
    purpose: "Produce editable video projects, grade previews, QA evidence, and platform exports.",
    managerAgentId: "agent-rowan",
    sortOrder: 3
  }
] as const;

export class StudioService {
  constructor(private readonly repository: StudioRepositoryPort) {}

  listOperationalSnapshots(): StudioOperationalSnapshot[] {
    return this.repository.listStudios().map((studio) => this.getOperationalSnapshot(studio.id));
  }

  getOperationalSnapshot(studioId: string, observedAt?: string): StudioOperationalSnapshot {
    return {
      studio: this.repository.getStudio(studioId),
      instances: this.repository.listStudioInstances(studioId),
      health: this.repository.getStudioHealth(studioId, observedAt)
    };
  }

  createStudio(input: {
    id?: string;
    key: string;
    name: string;
    purpose: string;
    managerAgentId: string;
    sortOrder?: number;
  }): StudioOperationalSnapshot {
    const studio = this.repository.createStudio(input);
    return this.getOperationalSnapshot(studio.id);
  }

  bootstrapPersonalStudios(): StudioOperationalSnapshot[] {
    const existingByKey = new Map(
      this.repository.listStudios().map((studio) => [studio.key, studio])
    );
    for (const blueprint of PERSONAL_STUDIO_BLUEPRINTS) {
      const existing = existingByKey.get(blueprint.key);
      if (existing) {
        if (
          existing.id !== blueprint.id
          || existing.name !== blueprint.name
          || existing.managerAgentId !== blueprint.managerAgentId
          || existing.sortOrder !== blueprint.sortOrder
        ) {
          throw new Error(`Studio bootstrap conflict for stable key: ${blueprint.key}`);
        }
        if (existing.status === "draft") {
          this.repository.transitionStudio(existing.id, "ready");
        }
        continue;
      }
      const created = this.repository.createStudio(blueprint);
      this.repository.transitionStudio(created.id, "ready");
    }
    return this.listOperationalSnapshots();
  }

  transitionStudio(studioId: string, status: Studio["status"]): StudioOperationalSnapshot {
    this.repository.transitionStudio(studioId, status);
    return this.getOperationalSnapshot(studioId);
  }

  createInstance(input: {
    id?: string;
    studioId: string;
    vmProviderInstanceId?: string | null;
    replaceCurrent?: boolean;
  }): StudioInstance {
    return this.repository.createStudioInstance(input);
  }

  recordHeartbeat(input: {
    studioId: string;
    instanceId: string;
    report: StudioHeartbeatReport;
  }): { instance: StudioInstance; health: StudioHealth; replayed: boolean } {
    return this.repository.recordStudioHeartbeat(input);
  }

  observeOffline(observedAt: string): StudioOperationalSnapshot[] {
    const changed = this.repository.observeOfflineStudioInstances(observedAt);
    const changedStudioIds = new Set(changed.map((instance) => instance.studioId));
    return [...changedStudioIds].map((studioId) => (
      this.getOperationalSnapshot(studioId, observedAt)
    ));
  }
}
