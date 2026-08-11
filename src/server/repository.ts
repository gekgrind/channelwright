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
      referenceReports: channel.referenceReports ?? [],
      referenceReportDecisions: channel.referenceReportDecisions ?? [],
      businessStrategies: channel.businessStrategies ?? [],
      businessStrategyDecisions: channel.businessStrategyDecisions ?? [],
      offerSelections: channel.offerSelections ?? [],
      monetizationPlans: channel.monetizationPlans ?? [],
      monetizationPlanDecisions: channel.monetizationPlanDecisions ?? [],
    })),
    videos: (parsed.videos ?? []).map((video) => ({
      ...video,
      distributionTargets: distributionTargetsSchema.parse(video.distributionTargets ?? youtubeOnlyDistributionTargets),
      platformArtifacts: video.platformArtifacts ?? [],
      platformApprovals: video.platformApprovals ?? [],
      kind: video.kind ?? "STANDARD",
    })),
    buildProjects: parsed.buildProjects ?? [],
    subscribers: parsed.subscribers ?? [],
    consentEvents: parsed.consentEvents ?? [],
    deliveryEvents: parsed.deliveryEvents ?? [],
    products: parsed.products ?? [],
    prices: parsed.prices ?? [],
    purchases: parsed.purchases ?? [],
    entitlements: parsed.entitlements ?? [],
    commerceEvents: parsed.commerceEvents ?? [],
    conversationMessages: parsed.conversationMessages ?? [],
    changeRequests: parsed.changeRequests ?? [],
    agentRuns: (parsed.agentRuns ?? []).map((run) => ({
      ...run,
      entityId: run.entityId ?? "legacy-unknown",
      provider: run.provider ?? "deterministic-fixture",
      model: run.model ?? "fixture-contract-v1",
      outputVersion: run.outputVersion ?? 1,
      usage: run.usage ?? { calls: 1 },
      sourceProvenance: run.sourceProvenance ?? [],
      errorCode: run.errorCode ?? null,
      retryOf: run.retryOf ?? null,
    })),
    auditEvents: parsed.auditEvents ?? [],
    idempotency: parsed.idempotency ?? {},
  };
}

export class MemoryWorkspaceRepository implements WorkspaceRepository {
  constructor(private snapshot: WorkspaceSnapshot = emptyWorkspace()) {}
  async load() { return structuredClone(this.snapshot); }
  async save(snapshot: WorkspaceSnapshot) { this.snapshot = structuredClone(snapshot); }
}
