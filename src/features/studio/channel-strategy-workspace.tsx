"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, RefreshCcw, ShieldCheck, XCircle } from "lucide-react";
import {
  approvedResearchArtifactSchema,
  channelStrategyResultSchema,
  strategyDraftSchema,
  strategyQAResultSchema,
  strategyRevisionSchema,
  type ChannelStrategyResult,
  type StrategyQAResult,
} from "@/domain/production-workflows";
import {
  fetchWorkflowDetail,
  fetchWorkflowList,
  POLLING_WORKFLOW_STATUSES,
  startWorkflow,
  submitApprovalDecision,
  type ApprovalDecision,
  type WorkflowList,
} from "./workflow-api";

type WorkflowDetail = {
  workflow: { id: string; status: string; created_at: string; current_run_id: string };
  runs: Array<{ id: string; status: string; input_payload: Record<string, unknown>; context_payload: Record<string, unknown>; output_payload: unknown; error_code: string | null; artifact_hash: string | null; provenance_hash: string | null }>;
  steps: Array<{ id: string; workflow_run_id: string; step_key: string; status: string; output_payload: unknown; attempt_count: number; max_attempts: number; error_code: string | null }>;
  attempts: unknown[];
  approvals: Array<{ id: string; workflow_run_id: string; status: string; decision_note: string | null; requested_at: string; decided_at: string | null }>;
  events: unknown[];
  researchBudgets: Array<{ workflow_run_id: string; parent_run_id: string | null; root_run_id: string; used_totals: Record<string, number>; provider_identities: string[]; model_identities: string[]; exhaustion_code: string | null }>;
  researchUsageOperations: unknown[];
};

export function ChannelStrategyWorkspace({ initial }: { initial?: WorkflowList }) {
  const [engine, setEngine] = useState(initial);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const strategyWorkflows = useMemo(() => engine?.workflows.filter((item) => item.workflow_type === "CHANNEL_STRATEGY") ?? [], [engine]);
  const approvedResearch = useMemo(() => engine?.workflows.find((item) => item.workflow_type === "CHANNEL_RESEARCH" && item.status === "COMPLETED"), [engine]);
  const activeId = detail?.workflow.id ?? strategyWorkflows[0]?.id;

  const load = async (workflowId?: string) => {
    const listPayload = await fetchWorkflowList("Could not refresh strategy workflows.");
    setEngine(listPayload.workflowEngine);
    const selected = workflowId ?? detail?.workflow.id ?? listPayload.workflowEngine.workflows.find((item) => item.workflow_type === "CHANNEL_STRATEGY")?.id;
    if (!selected) return;
    setDetail(await fetchWorkflowDetail<WorkflowDetail>(selected, "Could not load the strategy workflow."));
  };

  useEffect(() => {
    if (!activeId) return;
    let disposed = false;
    const refresh = () => load(activeId).catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not refresh strategy."); });
    void refresh();
    const status = detail?.workflow.status ?? strategyWorkflows[0]?.status ?? "";
    const timer = POLLING_WORKFLOW_STATUSES.includes(status) ? setInterval(refresh, 4_000) : undefined;
    return () => { disposed = true; if (timer) clearInterval(timer); };
    // Polling intentionally follows durable workflow identity and status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, detail?.workflow.status]);

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(null); setNotice(null);
    try {
      const payload = await startWorkflow(
        "CHANNEL_STRATEGY",
        { researchWorkflowId: String(form.get("researchWorkflowId")), researchRunId: String(form.get("researchRunId")) },
        "Could not start channel strategy.",
      );
      await load(payload.operationResult.workflowId);
      setNotice("Strategy queued from the exact approved research run. The server persisted its immutable integrity snapshot.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start channel strategy."); }
    finally { setBusy(false); }
  };

  const decide = async (decision: ApprovalDecision) => {
    const run = detail?.runs[0];
    const approval = detail?.approvals.find((item) => item.workflow_run_id === run?.id && item.status === "PENDING");
    if (!approval || !detail) return;
    const note = decision === "REQUEST_REVISION" ? revisionNote.trim() : undefined;
    if (decision === "REQUEST_REVISION" && !note) return;
    setBusy(true); setError(null);
    try {
      await submitApprovalDecision(detail.workflow.id, approval.id, decision, note, "Could not record the strategy decision.");
      await load(detail.workflow.id);
      if (decision === "REQUEST_REVISION") setRevisionNote("");
      setNotice(`${decision.replaceAll("_", " ")} recorded. Exact-version lineage remains immutable.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the strategy decision."); }
    finally { setBusy(false); }
  };

  const run = detail?.runs[0];
  const currentSteps = detail?.steps.filter((item) => item.workflow_run_id === run?.id) ?? [];
  const step = (key: string) => currentSteps.find((item) => item.step_key === key)?.output_payload;
  const upstream = approvedResearchArtifactSchema.safeParse(step("validate-approved-research"));
  const draft = strategyDraftSchema.safeParse(step("draft-strategy"));
  const revision = strategyRevisionSchema.safeParse(step("bounded-strategy-revision"));
  const initialQa = strategyQAResultSchema.safeParse(step("initial-strategy-qa"));
  const finalQa = strategyQAResultSchema.safeParse(step("final-strategy-qa"));
  const result = channelStrategyResultSchema.safeParse(run?.output_payload);
  const budget = detail?.researchBudgets.find((item) => item.workflow_run_id === run?.id);
  const pendingApproval = detail?.approvals.some((item) => item.workflow_run_id === run?.id && item.status === "PENDING");

  return <div className="research-workspace strategy-workspace">
    <section className="research-hero"><div><p className="eyebrow">Approved research → channel strategy</p><h2>Build one auditable strategy</h2><p>Channelwright consumes an exact approved research run, preserves its integrity snapshot, and pauses after independent QA for your decision.</p></div><span>NO DOWNSTREAM CONTENT</span></section>
    {error && <div className="error-banner" role="alert"><AlertTriangle size={17} /> {error}</div>}
    {notice && <div className="success-banner" role="status"><Check size={17} /> {notice}</div>}
    <form className="research-request" onSubmit={start}>
      <div><label>Approved research workflow ID<input name="researchWorkflowId" required defaultValue={approvedResearch?.id ?? ""} /></label><label>Exact approved research run ID<input name="researchRunId" required defaultValue={approvedResearch?.current_run_id ?? ""} /></label></div>
      <p><ShieldCheck size={15} /> The server rejects unapproved, cross-owner, mutable, malformed, missing, or integrity-mismatched research. It never selects “latest” silently.</p>
      <button className="button button-accent" disabled={busy || !approvedResearch}>{busy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />} Start bounded strategy</button>
    </form>
    {!approvedResearch && <div className="error-banner"><AlertTriangle size={17} /> Approve an exact CHANNEL_RESEARCH run before starting strategy.</div>}
    {strategyWorkflows.length > 0 && <section className="research-history"><header><h3>Strategy ledger</h3><button type="button" className="button button-quiet" onClick={() => void load()}><RefreshCcw size={14} /> Refresh</button></header>{strategyWorkflows.slice(0, 8).map((workflow) => <button type="button" key={workflow.id} className={workflow.id === activeId ? "selected" : ""} onClick={() => void load(workflow.id)}><span>{new Date(workflow.created_at).toLocaleString()}</span><b>{workflow.status.replaceAll("_", " ")}</b><small>{workflow.id}</small></button>)}</section>}
    {detail && <section className="research-run"><header><div><p className="eyebrow">Durable strategy execution</p><h2>{detail.workflow.status.replaceAll("_", " ")}</h2></div><small>{run?.id}</small></header><div className="research-steps">{currentSteps.map((item) => <span key={item.id} className={item.status === "COMPLETED" ? "done" : item.status === "FAILED" ? "failed" : ""}><b>{item.step_key.replaceAll("-", " ")}</b><small>{item.status.replaceAll("_", " ")} · {item.attempt_count}/{item.max_attempts}</small></span>)}</div>{run?.error_code && <p className="research-failure"><AlertTriangle size={15} /> Failed closed: {run.error_code}</p>}</section>}
    {result.success && <StrategyResultReview result={result.data} upstream={upstream.success ? upstream.data : undefined} initialQa={initialQa.success ? initialQa.data : undefined} finalQa={finalQa.success ? finalQa.data : undefined} revised={revision.success && revision.data.attempted} budget={budget} artifactHash={run?.artifact_hash ?? null} provenanceHash={run?.provenance_hash ?? null} />}
    {pendingApproval && <section className="research-decision"><div><p className="eyebrow">Human strategy decision required</p><h3>Approve, reject, or create a separately budgeted successor.</h3><label>Revision note<textarea rows={2} maxLength={2000} value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} placeholder="Required for a linked successor strategy run." /></label></div><div><button className="button" disabled={busy || !revisionNote.trim()} onClick={() => void decide("REQUEST_REVISION")}><RefreshCcw size={14} /> Request revision</button><button className="button" disabled={busy} onClick={() => void decide("REJECT")}><XCircle size={14} /> Reject</button><button className="button button-accent" disabled={busy} onClick={() => void decide("APPROVE")}><Check size={14} /> Approve exact strategy</button></div></section>}
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
