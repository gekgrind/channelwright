"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, RefreshCcw, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import {
  approvedStrategyArtifactSchema,
  channelContentIntelligenceResultSchema,
  contentDraftSchema,
  contentQAResultSchema,
  contentRevisionSchema,
  topicDiscoveryBundleSchema,
  type ChannelContentIntelligenceResult,
  type ContentQAResult,
  type ContentTopicOpportunity,
  type TopicDiscoveryBundle,
} from "@/domain/production-workflows";
import type { ViewerValueGate } from "@/domain/viewer-value";
import type { WorkflowList } from "./channel-research-workspace";

type WorkflowDetail = {
  workflow: { id: string; status: string; created_at: string; current_run_id: string };
  runs: Array<{ id: string; status: string; input_payload: Record<string, unknown>; context_payload: Record<string, unknown>; output_payload: unknown; error_code: string | null; artifact_hash: string | null; provenance_hash: string | null }>;
  steps: Array<{ id: string; workflow_run_id: string; step_key: string; status: string; output_payload: unknown; attempt_count: number; max_attempts: number; error_code: string | null }>;
  approvals: Array<{ id: string; workflow_run_id: string; status: string; decision_note: string | null; requested_at: string; decided_at: string | null }>;
  researchBudgets: Array<{ workflow_run_id: string; parent_run_id: string | null; root_run_id: string; used_totals: Record<string, number>; provider_identities: string[]; model_identities: string[]; exhaustion_code: string | null }>;
};

function message(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

const gateTone = (gate: ViewerValueGate) => gate === "PASS" ? "done" : gate === "REVISE" ? "warning" : "failed";

export function ContentIntelligenceWorkspace({ initial }: { initial?: WorkflowList }) {
  const [engine, setEngine] = useState(initial);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const contentWorkflows = useMemo(() => engine?.workflows.filter((item) => item.workflow_type === "CHANNEL_CONTENT_INTELLIGENCE") ?? [], [engine]);
  const approvedStrategy = useMemo(() => engine?.workflows.find((item) => item.workflow_type === "CHANNEL_STRATEGY" && item.status === "COMPLETED"), [engine]);
  const activeId = detail?.workflow.id ?? contentWorkflows[0]?.id;

  const load = async (workflowId?: string) => {
    const listResponse = await fetch("/api/workflows", { cache: "no-store" });
    const listPayload = await listResponse.json();
    if (!listResponse.ok) throw new Error(message(listPayload, "Could not refresh content workflows."));
    setEngine(listPayload.workflowEngine);
    const selected = workflowId ?? detail?.workflow.id ?? listPayload.workflowEngine.workflows.find((item: { workflow_type: string }) => item.workflow_type === "CHANNEL_CONTENT_INTELLIGENCE")?.id;
    if (!selected) return;
    const response = await fetch(`/api/workflows/${selected}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(message(payload, "Could not load the content workflow."));
    setDetail(payload);
  };

  useEffect(() => {
    if (!activeId) return;
    let disposed = false;
    const refresh = () => load(activeId).catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not refresh content intelligence."); });
    void refresh();
    const status = detail?.workflow.status ?? contentWorkflows[0]?.status ?? "";
    const timer = ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"].includes(status) ? setInterval(refresh, 4_000) : undefined;
    return () => { disposed = true; if (timer) clearInterval(timer); };
    // Polling intentionally follows durable workflow identity and status.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, detail?.workflow.status]);

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const size = Number(form.get("targetBacklogSize"));
    setBusy(true); setError(null); setNotice(null);
    try {
      const response = await fetch("/api/workflows", {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          operation: "START_WORKFLOW", workflowType: "CHANNEL_CONTENT_INTELLIGENCE", definitionVersion: 1,
          input: {
            strategyWorkflowId: String(form.get("strategyWorkflowId")),
            strategyRunId: String(form.get("strategyRunId")),
            ...(Number.isInteger(size) && size >= 5 && size <= 12 ? { targetBacklogSize: size } : {}),
          },
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Could not start content intelligence."));
      await load(payload.operationResult.workflowId);
      setNotice("Content intelligence queued from the exact approved strategy run.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start content intelligence."); }
    finally { setBusy(false); }
  };

  const decide = async (decision: "APPROVE" | "REJECT" | "REQUEST_REVISION") => {
    const run = detail?.runs[0];
    const approval = detail?.approvals.find((item) => item.workflow_run_id === run?.id && item.status === "PENDING");
    if (!approval || !detail) return;
    const note = decision === "REQUEST_REVISION" ? revisionNote.trim() : undefined;
    if (decision === "REQUEST_REVISION" && !note) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/workflows/${detail.workflow.id}/approvals/${approval.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, note }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Could not record the content decision."));
      await load(detail.workflow.id);
      if (decision === "REQUEST_REVISION") setRevisionNote("");
      setNotice(`${decision.replaceAll("_", " ")} recorded. Exact-version lineage remains immutable.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the content decision."); }
    finally { setBusy(false); }
  };

  const run = detail?.runs[0];
  const currentSteps = detail?.steps.filter((item) => item.workflow_run_id === run?.id) ?? [];
  const step = (key: string) => currentSteps.find((item) => item.step_key === key)?.output_payload;
  const upstream = approvedStrategyArtifactSchema.safeParse(step("validate-approved-strategy"));
  const discovery = topicDiscoveryBundleSchema.safeParse(step("discover-youtube-topics"));
  const draft = contentDraftSchema.safeParse(step("synthesize-backlog"));
  const revision = contentRevisionSchema.safeParse(step("bounded-content-revision"));
  const initialQa = contentQAResultSchema.safeParse(step("initial-content-qa"));
  const finalQa = contentQAResultSchema.safeParse(step("final-content-qa"));
  const result = channelContentIntelligenceResultSchema.safeParse(run?.output_payload);
  const budget = detail?.researchBudgets.find((item) => item.workflow_run_id === run?.id);
  const pendingApproval = detail?.approvals.some((item) => item.workflow_run_id === run?.id && item.status === "PENDING");

  return <div className="research-workspace content-workspace">
    <section className="research-hero"><div><p className="eyebrow">Approved strategy → content intelligence</p><h2>Decide what to make next, and why</h2><p>Channelwright expands approved pillars, retrieves fresh YouTube evidence, and gates every idea on identifiable viewer value before recommending anything.</p></div><span>VIEWER VALUE GATED</span></section>
    {error && <div className="error-banner" role="alert"><AlertTriangle size={17} /> {error}</div>}
    {notice && <div className="success-banner" role="status"><Check size={17} /> {notice}</div>}
    <form className="research-request" onSubmit={start}>
      <div>
        <label>Approved strategy workflow ID<input name="strategyWorkflowId" required defaultValue={approvedStrategy?.id ?? ""} /></label>
        <label>Exact approved strategy run ID<input name="strategyRunId" required defaultValue={approvedStrategy?.current_run_id ?? ""} /></label>
        <label>Target backlog size<input name="targetBacklogSize" type="number" min={5} max={12} defaultValue={8} /></label>
      </div>
      <p><ShieldCheck size={15} /> The server resolves and re-verifies the approved strategy, including its upstream research provenance. Unapproved, cross-owner, mutated, or mismatched artifacts fail closed.</p>
      <button className="button button-accent" disabled={busy || !approvedStrategy}>{busy ? <LoaderCircle className="spin" size={15} /> : <ShieldCheck size={15} />} Build bounded backlog</button>
    </form>
    {!approvedStrategy && <div className="error-banner"><AlertTriangle size={17} /> Approve an exact CHANNEL_STRATEGY run before building a content backlog.</div>}
    {contentWorkflows.length > 0 && <section className="research-history"><header><h3>Content ledger</h3><button type="button" className="button button-quiet" onClick={() => void load()}><RefreshCcw size={14} /> Refresh</button></header>{contentWorkflows.slice(0, 8).map((workflow) => <button type="button" key={workflow.id} className={workflow.id === activeId ? "selected" : ""} onClick={() => void load(workflow.id)}><span>{new Date(workflow.created_at).toLocaleString()}</span><b>{workflow.status.replaceAll("_", " ")}</b><small>{workflow.id}</small></button>)}</section>}
    {detail && <section className="research-run"><header><div><p className="eyebrow">Durable content execution</p><h2>{detail.workflow.status.replaceAll("_", " ")}</h2></div><small>{run?.id}</small></header><div className="research-steps">{currentSteps.map((item) => <span key={item.id} className={item.status === "COMPLETED" ? "done" : item.status === "FAILED" ? "failed" : ""}><b>{item.step_key.replaceAll("-", " ")}</b><small>{item.status.replaceAll("_", " ")} · {item.attempt_count}/{item.max_attempts}</small></span>)}</div>{run?.error_code && <p className="research-failure"><AlertTriangle size={15} /> Failed closed: {run.error_code}</p>}</section>}
    {result.success && <ContentBacklogReview
      result={result.data}
      discovery={discovery.success ? discovery.data : undefined}
      initialQa={initialQa.success ? initialQa.data : undefined}
      finalQa={finalQa.success ? finalQa.data : undefined}
      revised={revision.success && revision.data.attempted}
      budget={budget}
      artifactHash={run?.artifact_hash ?? null}
      provenanceHash={run?.provenance_hash ?? null}
      upstreamStrategyRunId={upstream.success ? upstream.data.reference.strategyRunId : result.data.upstreamStrategy.strategyRunId}
    />}
    {pendingApproval && <section className="research-decision"><div><p className="eyebrow">Human content decision required</p><h3>Approve, reject, or create a separately budgeted successor.</h3><label>Revision note<textarea rows={2} maxLength={2000} value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} placeholder="Required for a linked successor backlog run." /></label></div><div><button className="button" disabled={busy || !revisionNote.trim()} onClick={() => void decide("REQUEST_REVISION")}><RefreshCcw size={14} /> Request revision</button><button className="button" disabled={busy} onClick={() => void decide("REJECT")}><XCircle size={14} /> Reject</button><button className="button button-accent" disabled={busy} onClick={() => void decide("APPROVE")}><Check size={14} /> Approve backlog</button></div></section>}
    {!result.success && draft.success && <p className="success-banner">Backlog draft persisted; final QA and human review are still pending.</p>}
  </div>;
}

export function ViewerValuePanel({ topic }: { topic: ContentTopicOpportunity }) {
  const value = topic.viewerValue;
  const contract = value.contract;
  return <div className="viewer-value">
    <header><b className={gateTone(value.gate)}>Viewer value: {value.gate}</b><small>{contract.valuePromise.kinds.map((item) => item.label ?? item.kind.replaceAll("_", " ").toLowerCase()).join(" · ")}</small></header>
    <p><b>Viewer</b> {contract.intendedViewer}</p>
    <p><b>Need</b> {contract.viewerNeed.statement} <small>({contract.viewerNeed.kind.replaceAll("_", " ").toLowerCase()} · {contract.viewerNeed.urgency} urgency)</small></p>
    <p><b>Promise</b> {contract.valuePromise.statement}</p>
    <p><b>Viewer gains</b> {contract.valuePromise.viewerOutcome}</p>
    <p><b>Beyond existing videos</b> {contract.originalContribution.statement}</p>
    <div className="viewer-value-dimensions">
      {([["Specificity", contract.valuePromise.specificity], ["Originality", contract.originalContribution.assessment], ["Differentiation", contract.differentiation], ["Evidence", contract.evidenceSupport], ["Actionability", contract.actionability], ["Trust", contract.trustworthiness], ["Sustainability", contract.sustainability]] as const).map(([label, dimension]) => (
        <span key={label} className={dimension.verdict}><b>{label}</b>{dimension.verdict.replaceAll("_", " ")}<small>{dimension.rationale}</small></span>
      ))}
    </div>
    {value.integrityFindings.length > 0 && <div className="integrity-findings">{value.integrityFindings.map((finding, index) => <span key={`${finding.risk}-${index}`} className={finding.severity}><b>{finding.severity} · {finding.risk.replaceAll("_", " ")}</b>{finding.explanation}</span>)}</div>}
    <details><summary>Why this gate ({value.gateReasons.length})</summary><ul>{value.gateReasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></details>
  </div>;
}

export function ContentBacklogReview({ result, discovery, initialQa, finalQa, revised, budget, artifactHash, provenanceHash, upstreamStrategyRunId }: {
  result: ChannelContentIntelligenceResult;
  discovery?: TopicDiscoveryBundle;
  initialQa?: ContentQAResult;
  finalQa?: ContentQAResult;
  revised: boolean;
  budget?: WorkflowDetail["researchBudgets"][number];
  artifactHash: string | null;
  provenanceHash: string | null;
  upstreamStrategyRunId: string;
}) {
  const topicById = new Map(result.topics.map((topic) => [topic.topicId, topic]));
  const scoreById = new Map(result.scores.map((score) => [score.topicId, score]));
  const recommended = topicById.get(result.nextVideoRecommendation.topicId);

  return <section className="research-result content-result">
    <header><div><p className="eyebrow">Content backlog</p><h2>{result.backlog.length} ranked candidates across {result.pillarExpansions.length} approved pillars</h2><p>{result.recommendedNextAction}</p></div><span><b>{result.nextVideoRecommendation.confidence}</b> recommendation confidence</span></header>

    <section className="next-video">
      <header><p className="eyebrow"><Sparkles size={14} /> Make this next</p><h2>{recommended?.workingConcept ?? result.nextVideoRecommendation.topicId}</h2><p>{recommended?.workingAngle}</p></header>
      <div className="next-video-reasons"><h3>Why this one</h3><ol>{result.nextVideoRecommendation.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ol></div>
      <div className="research-columns">
        <article><h3>Viewer value</h3><p>{result.nextVideoRecommendation.viewerValueRationale}</p></article>
        <article><h3>Strategy alignment</h3><p>{result.nextVideoRecommendation.strategyAlignment}</p></article>
        <article><h3>Competition</h3><p>{result.nextVideoRecommendation.competitiveRationale}</p></article>
        <article><h3>Differentiation</h3><p>{result.nextVideoRecommendation.differentiationRationale}</p></article>
        <article><h3>Feasibility</h3><p>{result.nextVideoRecommendation.feasibilityRationale}</p></article>
      </div>
      {result.nextVideoRecommendation.conditions.length > 0 && <p className="next-video-conditions"><b>Conditions</b> {result.nextVideoRecommendation.conditions.join(" · ")}</p>}
      <small>{result.nextVideoRecommendation.evidenceIds.length} supporting evidence references · no view, subscriber, or revenue prediction is asserted</small>
      {recommended && <ViewerValuePanel topic={recommended} />}
    </section>

    <details open><summary>Ranked backlog ({result.backlog.length})</summary><div className="content-backlog">
      {[...result.backlog].sort((left, right) => left.rank - right.rank).map((entry) => {
        const topic = topicById.get(entry.topicId);
        const score = scoreById.get(entry.topicId);
        return <article key={entry.topicId} className="backlog-entry">
          <header><b>#{entry.rank} · {topic?.workingConcept ?? entry.topicId}</b><span>{entry.tier}</span>{score && <strong>{score.weightedTotal.toFixed(1)}<small>/10</small></strong>}</header>
          <p>{entry.inclusionRationale}</p>
          {topic && <p className="backlog-meta"><span>{topic.viewerIntent.replaceAll("_", " ").toLowerCase()}</span><span>{topic.shelfLife.classification.replaceAll("_", " ").toLowerCase()}</span><span>competition {topic.competitionSignal.level}</span><span>{topic.productionComplexity} complexity</span><span className={gateTone(topic.viewerValue.gate)}>value {topic.viewerValue.gate}</span></p>}
          {score && <details><summary>Score breakdown</summary><table><thead><tr><th>Dimension</th><th>Score</th><th>Weight</th><th>Basis</th><th>Rationale</th></tr></thead><tbody>
            {score.components.map((component) => <tr key={component.dimension}><td>{component.dimension.replaceAll("_", " ").toLowerCase()}</td><td>{component.score}</td><td>{component.weight.toFixed(2)}</td><td>{component.basis.toLowerCase()}</td><td>{component.rationale}</td></tr>)}
          </tbody></table></details>}
          {topic && <details><summary>Viewer value assessment</summary><ViewerValuePanel topic={topic} /></details>}
        </article>;
      })}
    </div></details>

    <details><summary>Pillar expansions ({result.pillarExpansions.length})</summary><div className="research-qa">{result.pillarExpansions.map((pillar) => <span key={pillar.pillarId}><b>{pillar.pillarName}</b>{pillar.audienceProblem}<small>Queries: {pillar.discoveryQueries.join(" · ")}</small></span>)}</div></details>

    <div className="research-columns">
      <article><h3>Risks</h3>{result.risks.map((risk, index) => <span key={`${risk.severity}-${index}`}><b>{risk.severity}</b>{risk.risk}</span>)}</article>
      <article><h3>Assumptions</h3>{result.assumptions.map((item) => <span key={item}>{item}</span>)}</article>
      <article><h3>Open questions</h3>{result.openQuestions.map((item) => <span key={item}>{item}</span>)}</article>
    </div>

    <details open><summary>Independent content QA</summary><div className="research-qa"><p>Initial: <b>{initialQa?.recommendation ?? "pending"}</b> · Final: <b>{finalQa?.recommendation ?? "pending"}</b> · score <b>{finalQa?.score ?? "—"}</b></p>{finalQa?.findings.map((finding, index) => <span key={`${finding.code}-${index}`} className={finding.severity}><b>{finding.severity} · {finding.code}</b>{finding.message}</span>)}</div></details>

    <details><summary>Discovery evidence ({discovery?.evidence.length ?? 0})</summary><div className="research-evidence">{discovery?.evidence.map((item) => item.url
      ? <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><b>{item.title}</b><span>{item.sourceType} · {item.origin}</span><small>{item.id}</small></a>
      : <span key={item.id}><b>Search observation</b><span>{item.query} · {item.origin}</span><small>{item.id}</small></span>)}
      {discovery?.completionStatus === "partial" && <p className="research-failure">Partial discovery: {discovery.limitations.join(" ")}</p>}
    </div></details>

    <footer>
      <span>AI: <b>{budget?.used_totals.inputTokens ?? 0}</b> input · <b>{budget?.used_totals.outputTokens ?? 0}</b> output tokens · automated revision {revised ? "used" : "not needed"}</span>
      <span>YouTube: <b>{budget?.used_totals.searches ?? 0}</b> searches · <b>{budget?.used_totals.providerQuotaUnits ?? 0}</b> quota units</span>
      <span>Models: {budget?.model_identities.join(", ") || "pending"}</span>
      <span>Lineage: parent {budget?.parent_run_id ?? "original"} · root {budget?.root_run_id ?? "pending"}</span>
      <small>Upstream approved strategy run: {upstreamStrategyRunId}</small>
      <small>Final artifact hash: {artifactHash ?? "assigned at final human decision"}</small>
      <small>Final provenance hash: {provenanceHash ?? "assigned at final human decision"}</small>
      <small>Ranked from a bounded public YouTube sample. Search result ordering is relevance, not demand or search volume.</small>
    </footer>
  </section>;
}
