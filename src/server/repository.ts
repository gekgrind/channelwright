import { promises as fs } from "node:fs";
import path from "node:path";
import { channelPreferencesSchema, distributionTargetsSchema, youtubeOnlyDistributionTargets } from "@/domain/contracts";
import { emptyWorkspace, type WorkspaceSnapshot } from "@/domain/entities";

export interface WorkspaceRepository {
  load(): Promise<WorkspaceSnapshot>;
  save(snapshot: WorkspaceSnapshot): Promise<void>;
}

export class JsonWorkspaceRepository implements WorkspaceRepository {
  private readonly file = path.join(process.cwd(), ".data", "mock-workspace.json");

  async load(): Promise<WorkspaceSnapshot> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.file, "utf8")) as WorkspaceSnapshot;
      return normalizeWorkspace(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyWorkspace();
      throw error;
    }
  }

  async save(snapshot: WorkspaceSnapshot): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(snapshot, null, 2), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporary, this.file);
  }
}

export function normalizeWorkspace(parsed: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...emptyWorkspace(),
    ...parsed,
    channels: (parsed.channels ?? []).map((channel) => ({
      ...channel,
      preferences: channelPreferencesSchema.parse(channel.preferences),
    })),
    videos: (parsed.videos ?? []).map((video) => ({
      ...video,
      distributionTargets: distributionTargetsSchema.parse(video.distributionTargets ?? youtubeOnlyDistributionTargets),
      platformArtifacts: video.platformArtifacts ?? [],
      platformApprovals: video.platformApprovals ?? [],
    })),
    agentRuns: parsed.agentRuns ?? [],
    auditEvents: parsed.auditEvents ?? [],
    idempotency: parsed.idempotency ?? {},
  };
}

export class MemoryWorkspaceRepository implements WorkspaceRepository {
  constructor(private snapshot: WorkspaceSnapshot = emptyWorkspace()) {}
  async load() { return structuredClone(this.snapshot); }
  async save(snapshot: WorkspaceSnapshot) { this.snapshot = structuredClone(snapshot); }
}
