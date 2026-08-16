"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, RefreshCcw, Search, XCircle } from "lucide-react";
import type { MediaProductionSnapshot } from "@/domain/media-production";
import {
  channelResearchResultSchema,
  researchDraftSchema,
  researchEvidenceBundleSchema,
  researchQAResultSchema,
  researchRevisionSchema,
  type ChannelResearchResult,
  type ResearchEvidenceBundle,
  type ResearchQAResult,
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

export type { WorkflowList } from "./workflow-api";

type WorkflowDetail = {
  workflow: { id: string; status: string; created_at: string };
  runs: Array<{ id: string; status: string; input_payload: Record<string, unknown>; output_payload: unknown; error_code: string | null }>;
  steps: Array<{ id: string; workflow_run_id: string; step_key: string; status: string; output_payload: unknown; attempt_count: number; max_attempts: number; error_code: string | null }>;
  attempts: unknown[];
  approvals: Array<{ id: string; status: string; decision_note: string | null; requested_at: string; decided_at: string | null }>;
  events: unknown[];
  researchBudgets: Array<{
    workflow_run_id: string;
    parent_run_id: string | null;
    root_run_id: string;
    limits: Record<string, number>;
    used_totals: Record<string, number>;
    reserved_totals: Record<string, number>;
    provider_identities: string[];
    model_identities: string[];
    exhaustion_code: string | null;
  }>;
  researchUsageOperations: unknown[];
};

export function ChannelResearchWorkspace({ initial, media }: { initial?: WorkflowList; media: MediaProductionSnapshot }) {
  const [engine, setEngine] = useState(initial);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const researchWorkflows = useMemo(() => engine?.workflows.filter((workflow) => workflow.workflow_type === "CHANNEL_RESEARCH") ?? [], [engine]);
  const activeId = detail?.workflow.id ?? researchWorkflows[0]?.id;

  const load = async (workflowId?: string) => {
    const listPayload = await fetchWorkflowList("Could not refresh research workflows.");
    setEngine(listPayload.workflowEngine);
    const selected = workflowId ?? detail?.workflow.id ?? listPayload.workflowEngine.workflows.find((item) => item.workflow_type === "CHANNEL_RESEARCH")?.id;
    if (!selected) return;
    setDetail(await fetchWorkflowDetail<WorkflowDetail>(selected, "Could not load the research workflow."));
  };

  useEffect(() => {
    if (!activeId) return;
    let disposed = false;
    const refresh = () => load(activeId).catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not refresh research."); });
    void refresh();
    const status = detail?.workflow.status ?? researchWorkflows[0]?.status ?? "";
    const timer = POLLING_WORKFLOW_STATUSES.includes(status) ? setInterval(refresh, 4_000) : undefined;
    return () => { disposed = true; if (timer) clearInterval(timer); };
    // durable id/status intentionally bound polling; load is not stable across renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, detail?.workflow.status]);

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    const form = new FormData(event.currentTarget);
    const goals = String(form.get("goals") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    const input = {
      channelConcept: String(form.get("channelConcept") ?? "").trim() || undefined,
      niche: String(form.get("niche") ?? "").trim() || undefined,
      targetAudience: String(form.get("targetAudience") ?? "").trim() || undefined,
      goals: goals.length ? goals : undefined,
      constraints: {
        faceless: form.get("faceless") === "on",
        preferredVideoLength: String(form.get("preferredVideoLength") ?? "").trim() || undefined,
        postingFrequency: String(form.get("postingFrequency") ?? "").trim() || undefined,
        geography: String(form.get("geography") ?? "").trim() || undefined,
        language: String(form.get("language") ?? "").trim() || undefined,
      },
    };
    try {
      const payload = await startWorkflow("CHANNEL_RESEARCH", input, "Could not start channel research.");
      await load(payload.operationResult.workflowId);
      setNotice("Research queued. A trusted workflow worker must claim the bounded provider steps.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start channel research."); }
    finally { setBusy(false); }
  };

  const decide = async (decision: ApprovalDecision) => {
    const approval = detail?.approvals.find((item) => item.status === "PENDING");
    if (!approval || !detail) return;
    const note = decision === "REQUEST_REVISION" ? revisionNote.trim() : undefined;
    if (decision === "REQUEST_REVISION" && !note) return;
    setBusy(true); setError(null);
    try {
      await submitApprovalDecision(detail.workflow.id, approval.id, decision, note, "Could not record the review decision.");
      await load(detail.workflow.id);
      if (decision === "REQUEST_REVISION") setRevisionNote("");
      setNotice(`${decision.replaceAll("_", " ")} recorded on the exact research run.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the review decision."); }
    finally { setBusy(false); }
  };

  const run = detail?.runs[0];
  const currentSteps = detail?.steps.filter((item) => item.workflow_run_id === run?.id) ?? [];
  const step = (key: string) => currentSteps.find((item) => item.step_key === key);
  const bundleParse = researchEvidenceBundleSchema.safeParse(step("retrieve-youtube-evidence")?.output_payload);
  const initialQaParse = researchQAResultSchema.safeParse(step("initial-qa")?.output_payload);
  const finalQaParse = researchQAResultSchema.safeParse(step("final-qa")?.output_payload);
  const revisionParse = researchRevisionSchema.safeParse(step("bounded-revision")?.output_payload);
  const draftParse = researchDraftSchema.safeParse(step("draft-research")?.output_payload);
  const resultParse = channelResearchResultSchema.safeParse(run?.output_payload);
  const bundle = bundleParse.success ? bundleParse.data : undefined;
  const initialQa = initialQaParse.success ? initialQaParse.data : undefined;
  const finalQa = finalQaParse.success ? finalQaParse.data : undefined;
  const revision = revisionParse.success ? revisionParse.data : undefined;
  const draft = draftParse.success ? draftParse.data : undefined;
  const totalInput = (draft?.modelUsage.inputTokens ?? 0) + (initialQa?.modelUsage.inputTokens ?? 0) + (revision?.modelUsage.inputTokens ?? 0) + (finalQa?.modelUsage.inputTokens ?? 0);
  const totalOutput = (draft?.modelUsage.outputTokens ?? 0) + (initialQa?.modelUsage.outputTokens ?? 0) + (revision?.modelUsage.outputTokens ?? 0) + (finalQa?.modelUsage.outputTokens ?? 0);
  const result = resultParse.success ? resultParse.data : undefined;
  const pendingApproval = detail?.approvals.some((item) => item.status === "PENDING");
  const durableBudget = detail?.researchBudgets?.find((item) => item.workflow_run_id === run?.id);

  return <div className="research-workspace">
    <section className="research-hero"><div><p className="eyebrow">Provider-backed strategy</p><h2>Research a YouTube channel concept</h2><p>Current public YouTube evidence is normalized, cited, independently checked, and held for your decision. Provider data is evidence, never instructions.</p></div><span>HUMAN REVIEW REQUIRED</span></section>
    {error && <div className="error-banner" role="alert"><AlertTriangle size={17} /> {error}</div>}
    {notice && <div className="success-banner" role="status"><Check size={17} /> {notice}</div>}
    <form className="research-request" onSubmit={start}>
      <label>Channel concept<textarea name="channelConcept" minLength={10} maxLength={2000} required rows={3} defaultValue="Faceless visual investigations of the hidden systems behind everyday businesses" /></label>
      <div><label>Niche <small>Optional</small><input name="niche" maxLength={500} placeholder="Business education" /></label><label>Target audience <small>Optional</small><input name="targetAudience" maxLength={1000} placeholder="Curious aspiring operators" /></label></div>
      <label>Goals <small>Comma-separated, optional</small><input name="goals" maxLength={1000} placeholder="Build an audience, sponsor revenue, sell research products" /></label>
      <div><label>Video length<input name="preferredVideoLength" maxLength={100} placeholder="8-15 minutes" /></label><label>Posting frequency<input name="postingFrequency" maxLength={100} placeholder="Weekly" /></label><label>Geography<input name="geography" maxLength={100} placeholder="United States" /></label><label>Language<input name="language" maxLength={100} defaultValue="English" /></label></div>
      <label className="research-check"><input type="checkbox" name="faceless" defaultChecked /> Must work without the creator appearing on camera</label>
      <button className="button button-accent" disabled={busy}>{busy ? <LoaderCircle className="spin" size={15} /> : <Search size={15} />} Start bounded research</button>
    </form>
    {researchWorkflows.length > 0 && <section className="research-history"><header><h3>Research ledger</h3><button type="button" className="button button-quiet" disabled={busy} onClick={() => void load()}><RefreshCcw size={14} /> Refresh</button></header>{researchWorkflows.slice(0, 8).map((workflow) => <button type="button" key={workflow.id} className={workflow.id === activeId ? "selected" : ""} onClick={() => void load(workflow.id)}><span>{new Date(workflow.created_at).toLocaleString()}</span><b>{workflow.status.replaceAll("_", " ")}</b><small>{workflow.id}</small></button>)}</section>}
    {detail && <section className="research-run"><header><div><p className="eyebrow">Durable execution</p><h2>{detail.workflow.status.replaceAll("_", " ")}</h2></div><small>{detail.workflow.id}</small></header><div className="research-steps">{currentSteps.map((item) => <span key={item.id} className={item.status === "COMPLETED" ? "done" : item.status === "FAILED" ? "failed" : ""}><b>{item.step_key.replaceAll("-", " ")}</b><small>{item.status.replaceAll("_", " ")} · {item.attempt_count}/{item.max_attempts}</small></span>)}</div>{run?.error_code && <p className="research-failure"><AlertTriangle size={15} /> Failed safely: {run.error_code}. No recommendation was accepted.</p>}</section>}
    {result && <ResearchResult result={result} bundle={bundle} initialQa={initialQa} finalQa={finalQa} usage={{ totalInput, totalOutput, revised: revision?.attempted ?? false }} durableBudget={durableBudget} />}
    {pendingApproval && <section className="research-decision"><div><p className="eyebrow">Human decision required</p><h3>The recommendation is not accepted until you decide.</h3><label>Revision note <textarea rows={2} maxLength={2000} value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} placeholder="Required only when requesting a linked successor run." /></label></div><div><button className="button" disabled={busy || !revisionNote.trim()} onClick={() => void decide("REQUEST_REVISION")}><RefreshCcw size={14} /> Request revision</button><button className="button" disabled={busy} onClick={() => void decide("REJECT")}><XCircle size={14} /> Reject</button><button className="button button-accent" disabled={busy} onClick={() => void decide("APPROVE")}><Check size={14} /> Approve exact run</button></div></section>}
    <section className="production-capability"><p className="eyebrow">Existing media boundary</p><h2>Transactional media records remain separate</h2><div><span>{media.assets.length}<b>ASSET VERSIONS</b></span><span>{media.renderJobs.length}<b>RENDER JOBS</b></span><span>{media.masters.length}<b>MASTER VERSIONS</b></span></div><small>RESEARCH DOES NOT RENDER OR PUBLISH MEDIA</small></section>
  </div>;
}

function ResearchResult({ result, bundle, initialQa, finalQa, usage, durableBudget }: {
  result: ChannelResearchResult;
  bundle?: ResearchEvidenceBundle;
  initialQa?: ResearchQAResult;
  finalQa?: ResearchQAResult;
  usage: { totalInput: number; totalOutput: number; revised: boolean };
  durableBudget?: WorkflowDetail["researchBudgets"][number];
}) {
  return <section className="research-result"><header><div><p className="eyebrow">Typed strategic result</p><h2>{result.concept.normalizedConcept}</h2><p>{result.concept.summary}</p></div><span><b>{result.recommendation.verdict.replaceAll("_", " ")}</b>{result.recommendation.confidence} confidence</span></header>
    <div className="research-viability">{Object.entries(result.viability).map(([name, item]) => <article key={name}><small>{name.replace(/([A-Z])/g, " $1")}</small><b>{item.verdict}</b><p>{item.rationale}</p><em>{item.evidenceIds.length} sources</em></article>)}</div>
    <div className="research-columns"><article><h3>Audience and demand</h3><p>{result.audience.targetViewer}</p>{result.audience.demandSignals.map((item) => <span key={item}>{item}</span>)}</article><article><h3>Content depth</h3><strong>{result.contentPotential.estimatedTopicDepth ?? "Unknown"} estimated topics</strong>{result.contentPotential.pillars.map((item) => <span key={item.name}><b>{item.name}</b>{item.description}</span>)}</article><article><h3>Monetization</h3>{result.monetization.paths.map((item) => <span key={item.type}><b>{item.type} · {item.confidence}</b>{item.rationale}</span>)}</article></div>
    <div className="research-columns"><article><h3>Differentiation</h3><p>{result.differentiation.originalityAssessment}</p>{result.differentiation.opportunities.map((item) => <span key={item}>{item}</span>)}</article><article><h3>Sustainability</h3><p>{result.sustainability.repeatability}</p><span><b>Production · {result.sustainability.productionDifficulty}</b>{result.sustainability.evergreenTrendBalance}</span><span><b>Defensibility</b>{result.sustainability.defensibility}</span></article><article><h3>Assumptions and uncertainty</h3>{result.assumptions.map((item) => <span key={`assumption-${item}`}><b>Assumption</b>{item}</span>)}{result.uncertainties.map((item) => <span key={`uncertainty-${item}`}><b>Uncertainty</b>{item}</span>)}</article></div>
    <section className="research-recommendation"><h3>Recommendation</h3><p>{result.recommendation.rationale}</p></section>
    <details><summary>Unanswered questions and next action</summary><div className="research-qa">{result.recommendation.unansweredQuestions.map((item) => <span key={item}>{item}</span>)}<p><b>Next:</b> {result.recommendation.nextAction}</p></div></details>
    <details open><summary>Evidence and provenance ({bundle?.evidence.length ?? 0})</summary><div className="research-evidence">{bundle?.evidence.map((item) => <a key={item.id} href={item.url} target="_blank" rel="noreferrer"><b>{item.title}</b><span>{item.sourceType} · {item.origin} · {item.channelTitle}</span><small>{item.id} · retrieved {new Date(item.retrievedAt).toLocaleString()}</small></a>)}</div></details>
    <details open><summary>Independent QA</summary><div className="research-qa"><p>Initial: <b>{initialQa?.recommendation ?? "pending"}</b> · Final: <b>{finalQa?.recommendation ?? "pending"}</b> · Score: <b>{finalQa?.score ?? "—"}</b></p>{finalQa?.findings.map((finding, index) => <span key={`${finding.code}-${index}`} className={finding.severity}><b>{finding.severity} · {finding.code}</b>{finding.message}</span>)}</div></details>
    <footer><span>YouTube: <b>{bundle?.usage.cacheStatus ?? "—"}</b> · {(durableBudget?.used_totals.providerRequests ?? bundle?.usage.providerRequests ?? 0).toLocaleString()} aggregate requests · {(durableBudget?.used_totals.providerQuotaUnits ?? bundle?.usage.quotaUnits ?? 0).toLocaleString()} quota units</span><span>AI: <b>{(durableBudget?.used_totals.inputTokens ?? usage.totalInput).toLocaleString()}</b> input · <b>{(durableBudget?.used_totals.outputTokens ?? usage.totalOutput).toLocaleString()}</b> output tokens · revision {usage.revised ? "used" : "not needed"}</span>{durableBudget && <span>Run budget: {durableBudget.used_totals.executionAttempts ?? 0} attempts · {durableBudget.used_totals.cacheHits ?? 0} cache hits · {durableBudget.used_totals.cacheMisses ?? 0} misses · models {durableBudget.model_identities.join(", ") || "pending"}</span>}{durableBudget?.parent_run_id && <small>Revision lineage: parent {durableBudget.parent_run_id} · root {durableBudget.root_run_id}</small>}{durableBudget?.exhaustion_code && <small>Budget stopped execution: {durableBudget.exhaustion_code}</small>}<small>No dollar estimate is shown because model pricing is not pinned in this run.</small></footer>
  </section>;
}
