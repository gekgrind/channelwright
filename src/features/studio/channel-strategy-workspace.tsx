"use client";

import type { FormEvent } from "react";
import { AlertTriangle, LoaderCircle, RefreshCcw, ShieldCheck } from "lucide-react";
import {
  approvedResearchArtifactSchema,
  channelStrategyResultSchema,
  strategyDraftSchema,
  strategyQAResultSchema,
  strategyRevisionSchema,
  type ChannelStrategyResult,
  type StrategyQAResult,
} from "@/domain/production-workflows";
import { runVersionOf, type WorkflowList } from "./workflow-api";
import { useWorkflowWorkspace } from "./use-workflow-workspace";
import { parseObjectPayload, textAt, UpstreamCard, useApprovedUpstream } from "./upstream-selection";
import { DecisionBar, WorkspaceFeedback } from "./workflow-controls";

type WorkflowDetail = {
  workflow: { id: string; status: string; created_at: string; current_run_id: string };
  runs: Array<{ id: string; status: string; input_payload: Record<string, unknown>; context_payload: Record<string, unknown>; output_payload: unknown; error_code: string | null; artifact_hash: string | null; provenance_hash: string | null; created_at?: string; completed_at?: string | null }>;
  steps: Array<{ id: string; workflow_run_id: string; step_key: string; status: string; output_payload: unknown; attempt_count: number; max_attempts: number; error_code: string | null }>;
  attempts: unknown[];
  approvals: Array<{ id: string; workflow_run_id: string; status: string; decision_note: string | null; requested_at: string; decided_at: string | null }>;
  events: unknown[];
  researchBudgets: Array<{ workflow_run_id: string; parent_run_id: string | null; root_run_id: string; used_totals: Record<string, number>; provider_identities: string[]; model_identities: string[]; exhaustion_code: string | null }>;
  researchUsageOperations: unknown[];
};

/** Research runs are named by the concept they evaluated and the verdict they reached. */
const describeResearch = (output: Record<string, unknown>) => {
  const verdict = textAt(output, ["recommendation", "verdict"]);
  return { title: textAt(output, ["concept", "normalizedConcept"]) ?? "Approved channel research", detail: verdict ? `Verdict: ${verdict.replaceAll("_", " ").toLowerCase()}` : undefined };
};

export function ChannelStrategyWorkspace({ initial }: { initial?: WorkflowList }) {
  const workspace = useWorkflowWorkspace<WorkflowDetail>({ initial, workflowType: "CHANNEL_STRATEGY", label: "strategy" });
  const { detail, busy } = workspace;
  const strategyWorkflows = workspace.workflows;
  const activeId = workspace.activeId;
  const selection = useApprovedUpstream({ engine: workspace.engine, workflowType: "CHANNEL_RESEARCH", label: "channel research", parse: parseObjectPayload, describe: describeResearch });
  const research = selection.upstream;

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!research) return;
    await workspace.start(
      { researchWorkflowId: research.workflowId, researchRunId: research.runId },
      "Strategy queued from the exact approved research run. The server persisted its immutable integrity snapshot.",
    );
  };

  const run = workspace.currentRun;
  const currentSteps = detail?.steps.filter((item) => item.workflow_run_id === run?.id) ?? [];
  const step = (key: string) => currentSteps.find((item) => item.step_key === key)?.output_payload;
  const upstream = approvedResearchArtifactSchema.safeParse(step("validate-approved-research"));
  const draft = strategyDraftSchema.safeParse(step("draft-strategy"));
  const revision = strategyRevisionSchema.safeParse(step("bounded-strategy-revision"));
  const initialQa = strategyQAResultSchema.safeParse(step("initial-strategy-qa"));
  const finalQa = strategyQAResultSchema.safeParse(step("final-strategy-qa"));
  const result = channelStrategyResultSchema.safeParse(run?.output_payload);
  const budget = detail?.researchBudgets.find((item) => item.workflow_run_id === run?.id);
  const version = detail && run ? runVersionOf(detail, run.id) : undefined;

  return <div className="research-workspace strategy-workspace">
    <section className="research-hero"><div><p className="eyebrow">Approved research → channel strategy</p><h2>Build one auditable strategy</h2><p>Channelwright consumes an exact approved research run, preserves its integrity snapshot, and pauses after independent QA for your decision.</p></div><span>NO DOWNSTREAM CONTENT</span></section>
    <WorkspaceFeedback label="strategy" loading={workspace.loading} busy={busy} error={workspace.error} refreshError={workspace.refreshError} notice={workspace.notice} polling={workspace.polling} onRetry={() => void workspace.refresh()} />
    {selection.eligible.length > 0 ? <form className="research-request" onSubmit={start}>
      <UpstreamCard heading="Build a strategy from" kindLabel="Research" selection={selection} disabled={busy} />
      <p><ShieldCheck size={15} /> The server rejects unapproved, cross-owner, mutable, malformed, missing, or integrity-mismatched research. It never selects “latest” silently.</p>
      <button className="button button-accent" disabled={busy || !research}>{busy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />} Start bounded strategy</button>
    </form> : !workspace.loading && <p className="upstream-empty">Approve an exact research run above before starting strategy. Strategy is only built from approved research.</p>}
    {strategyWorkflows.length > 0 && <section className="research-history"><header><h3>Strategy ledger</h3><button type="button" className="button button-quiet" disabled={busy} onClick={() => void workspace.refresh()}><RefreshCcw size={14} /> Refresh</button></header>{strategyWorkflows.slice(0, 8).map((workflow) => <button type="button" key={workflow.id} className={workflow.id === activeId ? "selected" : ""} aria-pressed={workflow.id === activeId} onClick={() => workspace.select(workflow.id)}><span>{new Date(workflow.created_at).toLocaleString()}</span><b>{workflow.status.replaceAll("_", " ")}</b><small>{workflow.id}</small></button>)}</section>}
    {detail && <section className="research-run"><header><div><p className="eyebrow">Durable strategy execution</p><h2>{detail.workflow.status.replaceAll("_", " ")}</h2></div><small>{run?.id}</small></header><div className="research-steps">{currentSteps.map((item) => <span key={item.id} className={item.status === "COMPLETED" ? "done" : item.status === "FAILED" ? "failed" : ""}><b>{item.step_key.replaceAll("-", " ")}</b><small>{item.status.replaceAll("_", " ")} · {item.attempt_count}/{item.max_attempts}</small></span>)}</div>{run?.error_code && <p className="research-failure"><AlertTriangle size={15} /> Failed closed: {run.error_code}</p>}</section>}
    {result.success && <StrategyResultReview result={result.data} upstream={upstream.success ? upstream.data : undefined} initialQa={initialQa.success ? initialQa.data : undefined} finalQa={finalQa.success ? finalQa.data : undefined} revised={revision.success && revision.data.attempted} budget={budget} artifactHash={run?.artifact_hash ?? null} provenanceHash={run?.provenance_hash ?? null} />}
    {workspace.pendingApproval && <DecisionBar
      busy={busy}
      title="Human strategy decision required"
      explanation="Approve this exact strategy, reject it, or create a separately budgeted successor run. Exact-version lineage remains immutable."
      versionLabel={version ? `Strategy run v${version}` : undefined}
      approveLabel="Approve exact strategy"
      revisionPlaceholder="Required for a linked successor strategy run."
      artifactLabel="strategy"
      onDecide={(decision, note) => workspace.decide(decision, note, `${decision.replaceAll("_", " ")} recorded. Exact-version lineage remains immutable.`)}
    />}
    {!result.success && draft.success && <p className="success-banner">Strategy draft persisted; final QA and human review are still pending.</p>}
  </div>;
}

export function StrategyResultReview({ result, upstream, initialQa, finalQa, revised, budget, artifactHash, provenanceHash }: {
  result: ChannelStrategyResult;
  upstream?: ReturnType<typeof approvedResearchArtifactSchema.parse>;
  initialQa?: StrategyQAResult;
  finalQa?: StrategyQAResult;
  revised: boolean;
  budget?: WorkflowDetail["researchBudgets"][number];
  artifactHash: string | null;
  provenanceHash: string | null;
}) {
  return <section className="research-result strategy-result"><header><div><p className="eyebrow">Typed channel strategy</p><h2>{result.strategicThesis.channelConcept.statement}</h2><p>{result.strategicThesis.strategicRationale.statement}</p></div><span><b>{result.recommendation.decision.replaceAll("_", " ")}</b>{result.recommendation.confidence} confidence</span></header>
    <section className="accepted-evidence"><header><div><p className="eyebrow">Exact approved upstream research</p><h3>{result.upstreamResearch.researchRunId}</h3></div><strong>{result.upstreamResearch.finalQaScore}<small>/100 QA</small></strong></header><p>Workflow {result.upstreamResearch.researchWorkflowId} · definition v{result.upstreamResearch.workflowDefinitionVersion} · output schema v{result.upstreamResearch.outputSchemaVersion}</p><small>Approved {new Date(result.upstreamResearch.approvedAt).toLocaleString()} by {result.upstreamResearch.approvedBy}</small><small>Artifact {result.upstreamResearch.researchArtifactHash} · evidence {result.upstreamResearch.evidenceProvenanceHash}</small></section>
    <div className="research-columns"><article><h3>Audience</h3><p>{result.targetAudience.primary.description}</p>{result.targetAudience.primary.needs.map((item) => <span key={item}>{item}</span>)}<small>{result.targetAudience.demographicPrecisionLimit}</small></article><article><h3>Positioning</h3><p>{result.positioning.positioningStatement.statement}</p><span><b>Differentiation</b>{result.positioning.differentiation.statement}</span><span><b>Deliberately not</b>{result.positioning.deliberatelyNot.join(" · ")}</span></article><article><h3>Channel promise</h3><p>{result.channelPromise.corePromise.statement}</p><span><b>Viewer value</b>{result.channelPromise.viewerValue.statement}</span></article></div>
    <div className="research-columns"><article><h3>Value proposition</h3><p>{result.valueProposition.functionalValue.statement}</p><span><b>Reason to return</b>{result.valueProposition.recurringReasonToReturn.statement}</span></article><article><h3>Objectives</h3>{result.strategicObjectives.launch.map((item) => <span key={item}><b>Launch</b>{item}</span>)}{result.strategicObjectives.strategicLearning.map((item) => <span key={item}><b>Learn</b>{item}</span>)}</article><article><h3>Assumptions and uncertainty</h3>{result.assumptionsAndUncertainties.assumptions.map((item) => <span key={item}><b>Assumption</b>{item}</span>)}{result.assumptionsAndUncertainties.evidenceGaps.map((item) => <span key={item}><b>Evidence gap</b>{item}</span>)}</article></div>
    <details open><summary>Strategic content pillars ({result.contentPillars.length})</summary><div className="research-qa">{result.contentPillars.map((item) => <span key={item.name}><b>{item.name} · {item.evidenceIds.length} evidence references</b>{item.purpose}<small>{item.strategicRationale}</small></span>)}</div></details>
    <details open><summary>Monetization hypotheses ({result.monetizationArchitecture.length})</summary><div className="research-qa">{result.monetizationArchitecture.map((item) => <span key={item.path}><b>{item.label} · {item.confidence} · {item.maturityStage}</b>{item.rationale}<small>No revenue estimate is asserted.</small></span>)}</div></details>
    <details><summary>KPI framework — no observed analytics ({result.kpiFramework.length})</summary><div className="research-qa">{result.kpiFramework.map((item) => <span key={`${item.metric}-${item.label}`}><b>{item.label} · baseline {item.baselineState}</b>{item.purpose}<small>Future measurement: {item.futureMeasurementRequirement} · proposed target {item.proposedTarget ?? "not set"}</small></span>)}</div></details>
    <details open><summary>Risks and evidence limitations</summary><div className="research-qa">{result.strategicRisks.map((item, index) => <span key={`${item.category}-${index}`}><b>{item.category} · {item.severity}</b>{item.risk}<small>{item.evidenceIds.length} evidence references</small></span>)}</div></details>
    <section className="research-recommendation"><h3>{result.recommendation.decision.replaceAll("_", " ")}</h3>{result.recommendation.reasons.map((item) => <p key={item}>{item}</p>)}<small>{result.recommendation.evidenceIds.length} supporting evidence references</small></section>
    <details open><summary>Independent strategy QA</summary><div className="research-qa"><p>Initial: <b>{initialQa?.recommendation ?? "pending"}</b> · Final: <b>{finalQa?.recommendation ?? "pending"}</b> · score <b>{finalQa?.score ?? "—"}</b></p>{finalQa?.findings.map((finding, index) => <span key={`${finding.code}-${index}`} className={finding.severity}><b>{finding.severity} · {finding.code}</b>{finding.message}</span>)}</div></details>
    <details><summary>Evidence references ({upstream?.evidenceBundle.evidence.length ?? 0})</summary><div className="research-evidence">{upstream?.evidenceBundle.evidence.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><b>{item.title}</b><span>{item.sourceType} · {item.origin}</span><small>{item.id}</small></a>)}</div></details>
    <footer><span>AI: <b>{budget?.used_totals.inputTokens ?? 0}</b> input · <b>{budget?.used_totals.outputTokens ?? 0}</b> output tokens · automated revision {revised ? "used" : "not needed"}</span><span>Models: {budget?.model_identities.join(", ") || "pending"}</span><span>Lineage: parent {budget?.parent_run_id ?? "original"} · root {budget?.root_run_id ?? "pending"}</span><small>Final artifact hash: {artifactHash ?? "assigned at final human decision"}</small><small>Final provenance hash: {provenanceHash ?? "assigned at final human decision"}</small><small>This strategy is based on a bounded research sample, not a complete census of YouTube or the market.</small></footer>
  </section>;
}
