import {
  approvedContentIntelligenceReferenceSchema, approvedResearchReferenceSchema, approvedStrategyReferenceSchema,
  approvedVideoBriefReferenceSchema, approvedVideoDecisionReferenceSchema, approvedVideoDiagnosisReferenceSchema,
  approvedVideoExperimentReferenceSchema, approvedVideoPackagingReferenceSchema, approvedVideoPerformanceReferenceSchema,
  approvedVideoPortfolioReferenceSchema, approvedVideoReleaseReferenceSchema, approvedVideoScriptReferenceSchema,
  decisionTypeSchema, experimentTypeSchema,
} from "@/domain/production-workflows";
import { LINEAR_STAGES, REFERENCE_SHAPE, type LineageApprovalRow, type LineageRows, type LineageRunRow, type LineageWorkflowRow } from "./lineage-rows";

/**
 * Builds lineage rows the way production persists them: each run's input holds
 * the request ids and the approved reference of its upstream run, and every
 * reference is parsed by the real domain schema, so a shape drift fails here.
 */

export type RunRef = { workflowId: string; runId: string };

const SCHEMA = {
  CHANNEL_RESEARCH: approvedResearchReferenceSchema,
  CHANNEL_STRATEGY: approvedStrategyReferenceSchema,
  CHANNEL_CONTENT_INTELLIGENCE: approvedContentIntelligenceReferenceSchema,
  CHANNEL_VIDEO_BRIEF: approvedVideoBriefReferenceSchema,
  CHANNEL_VIDEO_SCRIPT: approvedVideoScriptReferenceSchema,
  CHANNEL_VIDEO_PACKAGING: approvedVideoPackagingReferenceSchema,
  CHANNEL_VIDEO_RELEASE: approvedVideoReleaseReferenceSchema,
  CHANNEL_VIDEO_PERFORMANCE: approvedVideoPerformanceReferenceSchema,
  CHANNEL_VIDEO_DIAGNOSIS: approvedVideoDiagnosisReferenceSchema,
  CHANNEL_VIDEO_DECISION: approvedVideoDecisionReferenceSchema,
  CHANNEL_VIDEO_EXPERIMENT: approvedVideoExperimentReferenceSchema,
} as const;

const HASH = "a".repeat(64);
const STAGE = new Map(LINEAR_STAGES.map((stage) => [stage.type, stage]));

export class LineageBuilder {
  readonly workflows: LineageWorkflowRow[] = [];
  readonly runs: LineageRunRow[] = [];
  readonly approvals: LineageApprovalRow[] = [];
  /** The approved reference each run would hand to its consumers. */
  private readonly references = new Map<string, Record<string, unknown>>();
  private readonly ancestry = new Map<string, Map<string, RunRef>>();
  private sequence = 0;

  uuid() {
    this.sequence += 1;
    return `00000000-0000-4000-8000-${this.sequence.toString(16).padStart(12, "0")}`;
  }

  private stamp() {
    return new Date(Date.UTC(2026, 9, 1) + this.sequence * 60_000).toISOString();
  }

  private addWorkflow(workflowType: string) {
    const id = this.uuid();
    this.workflows.push({ id, workflowType, status: "COMPLETED", createdAt: this.stamp() });
    return id;
  }

  private addRun(workflowId: string, input: Record<string, unknown>, previousRunId: string | null = null): RunRef {
    const runId = this.uuid();
    this.runs.push({ id: runId, workflowId, status: "COMPLETED", createdAt: this.stamp(), previousRunId, input });
    return { workflowId, runId };
  }

  private remember(type: string, own: RunRef, upstream: RunRef | null) {
    const ancestry = new Map(upstream ? this.ancestry.get(upstream.runId) : undefined).set(type, own);
    this.ancestry.set(own.runId, ancestry);
    if (type in SCHEMA) this.references.set(own.runId, this.reference(type, own, upstream));
  }

  /** The real approved reference for a run, nesting its upstream exactly as the domain does. */
  private reference(type: string, own: RunRef, upstream: RunRef | null): Record<string, unknown> {
    const { prefix, upstreamKey } = REFERENCE_SHAPE[type];
    const base: Record<string, unknown> = {
      [`${prefix}WorkflowId`]: own.workflowId, [`${prefix}RunId`]: own.runId,
      workflowDefinitionVersion: 1, outputSchemaVersion: 1, approvalId: this.uuid(), approvedBy: this.uuid(),
      approvedAt: this.stamp(), finalQaState: "accept", finalQaScore: 90,
      // Research names its provenance after its evidence bundle; every later stage after itself.
      [`${prefix}ArtifactHash`]: HASH, [prefix === "research" ? "evidenceProvenanceHash" : `${prefix}ProvenanceHash`]: HASH, parentRunId: null, rootRunId: own.runId,
    };
    if (upstreamKey && upstream) base[upstreamKey] = this.references.get(upstream.runId);
    if (type === "CHANNEL_VIDEO_DECISION") Object.assign(base, { decisionType: decisionTypeSchema.options[0], experimentEligible: true });
    if (type === "CHANNEL_VIDEO_EXPERIMENT" && upstream) {
      Object.assign(base, {
        experimentType: experimentTypeSchema.options[0], portfolioEligible: true,
        upstreamVideoDecision: { decisionWorkflowId: upstream.workflowId, decisionRunId: upstream.runId, decisionArtifactHash: HASH, decisionProvenanceHash: HASH, decisionType: decisionTypeSchema.options[0], experimentEligible: true },
      });
    }
    return SCHEMA[type as keyof typeof SCHEMA].parse(base) as Record<string, unknown>;
  }

  research(input: { niche?: string; channelConcept?: string } = { niche: "Budget mechanical keyboards" }): RunRef {
    const own = this.addRun(this.addWorkflow("CHANNEL_RESEARCH"), { ...input });
    this.remember("CHANNEL_RESEARCH", own, null);
    return own;
  }

  /** A linear stage started from an approved upstream run. */
  stage(type: string, upstream: RunRef): RunRef {
    const stage = STAGE.get(type)!;
    const own = this.addRun(this.addWorkflow(type), {
      [stage.requestWorkflowKey]: upstream.workflowId,
      [stage.requestRunKey]: upstream.runId,
      [stage.referenceKey]: structuredClone(this.references.get(upstream.runId)),
    });
    this.remember(type, own, upstream);
    return own;
  }

  /** Research → … → the given stage, returning every run by type. */
  chain(until: string, root = this.research()): Record<string, RunRef> {
    const out: Record<string, RunRef> = { CHANNEL_RESEARCH: root };
    let upstream = root;
    for (const stage of LINEAR_STAGES) {
      upstream = this.stage(stage.type, upstream);
      out[stage.type] = upstream;
      if (stage.type === until) break;
    }
    return out;
  }

  /** A human revision: a new run in the same workflow, same input, pointing at its predecessor. */
  revise(run: RunRef, inputOverride?: Record<string, unknown>): RunRef {
    const previous = this.runs.find((row) => row.id === run.runId)!;
    const type = this.workflows.find((row) => row.id === run.workflowId)!.workflowType;
    const own = this.addRun(run.workflowId, inputOverride ?? structuredClone(previous.input), run.runId);
    this.ancestry.set(own.runId, new Map(this.ancestry.get(run.runId)).set(type, own));
    if (type in SCHEMA) this.references.set(own.runId, this.reference(type, own, this.ancestry.get(run.runId)!.get(STAGE.get(type)?.upstreamType ?? "") ?? null));
    return own;
  }

  portfolio(experiments: RunRef[]): RunRef {
    const own = this.addRun(this.addWorkflow("CHANNEL_VIDEO_PORTFOLIO"), {
      experimentSelections: experiments.map((run) => ({ experimentWorkflowId: run.workflowId, experimentRunId: run.runId })),
      approvedVideoExperimentReferences: experiments.map((run) => structuredClone(this.references.get(run.runId))),
    });
    const first = this.ancestry.get(experiments[0].runId)!;
    this.ancestry.set(own.runId, new Map([["CHANNEL_RESEARCH", first.get("CHANNEL_RESEARCH")!], ["CHANNEL_STRATEGY", first.get("CHANNEL_STRATEGY")!], ["CHANNEL_VIDEO_PORTFOLIO", own]]));
    return own;
  }

  /** The approved portfolio reference Intelligence persists, with its exact flat anchors. */
  portfolioReference(portfolio: RunRef, anchors?: { researchRunId?: string; strategyRunId?: string }) {
    const ancestry = this.ancestry.get(portfolio.runId)!;
    return approvedVideoPortfolioReferenceSchema.parse({
      portfolioWorkflowId: portfolio.workflowId, portfolioRunId: portfolio.runId, workflowDefinitionVersion: 1, outputSchemaVersion: 1,
      approvalId: this.uuid(), approvedBy: this.uuid(), approvedAt: this.stamp(), finalQaState: "accept", finalQaScore: 90,
      portfolioArtifactHash: HASH, portfolioProvenanceHash: HASH, parentRunId: null, rootRunId: portfolio.runId, portfolioReady: true,
      strategyAnchor: { strategyRunId: anchors?.strategyRunId ?? ancestry.get("CHANNEL_STRATEGY")!.runId, strategyArtifactHash: HASH },
      researchAnchor: { researchRunId: anchors?.researchRunId ?? ancestry.get("CHANNEL_RESEARCH")!.runId, researchArtifactHash: HASH },
    }) as Record<string, unknown>;
  }

  intelligence(portfolios: RunRef[], references = portfolios.map((run) => this.portfolioReference(run))): RunRef {
    return this.addRun(this.addWorkflow("CHANNEL_VIDEO_INTELLIGENCE"), {
      portfolioSelections: portfolios.map((run) => ({ portfolioWorkflowId: run.workflowId, portfolioRunId: run.runId })),
      approvedVideoPortfolioReferences: references,
    });
  }

  conceptValidation(): RunRef {
    return this.addRun(this.addWorkflow("CHANNEL_CONCEPT_VALIDATION"), { proposedConcept: "A channel about budget keyboards for beginners" });
  }

  pending(run: RunRef): string {
    const id = this.uuid();
    this.approvals.push({ id, workflowId: run.workflowId, runId: run.runId, status: "PENDING", requestedAt: this.stamp(), decidedAt: null });
    return id;
  }

  input(run: RunRef) {
    return this.runs.find((row) => row.id === run.runId)!.input;
  }

  rows(): LineageRows {
    return { workflows: [...this.workflows], runs: [...this.runs], approvals: [...this.approvals] };
  }
}
