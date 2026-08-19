"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, LoaderCircle, RefreshCcw, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import {
  channelVideoBriefResultSchema,
  videoBriefQAResultSchema,
  type ChannelContentIntelligenceResult,
  type ChannelVideoBriefResult,
  type VideoBriefQAResult,
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

const EVIDENCE_STATUS_LABEL: Record<string, string> = {
  SUPPORTED: "Supported",
  STRATEGIC_ASSUMPTION: "Strategic assumption",
  PRODUCTION_ASSUMPTION: "Production assumption",
  RESEARCH_REQUIRED: "Research required",
  MUST_NOT_CLAIM: "Must not claim",
};

/** An approved content-intelligence artifact plus the topics eligible to brief. */
type EligibleUpstream = {
  workflowId: string;
  runId: string;
  result: ChannelContentIntelligenceResult;
};

export function VideoBriefWorkspace({ initial }: { initial?: WorkflowList }) {
  const [engine, setEngine] = useState(initial);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [upstream, setUpstream] = useState<EligibleUpstream | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState("");

  const briefWorkflows = useMemo(() => engine?.workflows.filter((item) => item.workflow_type === "CHANNEL_VIDEO_BRIEF") ?? [], [engine]);
  const approvedContent = useMemo(() => engine?.workflows.find((item) => item.workflow_type === "CHANNEL_CONTENT_INTELLIGENCE" && item.status === "COMPLETED"), [engine]);
  const activeId = detail?.workflow.id ?? briefWorkflows[0]?.id;

  const load = async (workflowId?: string) => {
    const listResponse = await fetch("/api/workflows", { cache: "no-store" });
    const listPayload = await listResponse.json();
    if (!listResponse.ok) throw new Error(message(listPayload, "Could not refresh video brief workflows."));
    setEngine(listPayload.workflowEngine);
    const selected = workflowId ?? detail?.workflow.id ?? listPayload.workflowEngine.workflows.find((item: { workflow_type: string }) => item.workflow_type === "CHANNEL_VIDEO_BRIEF")?.id;
    if (!selected) return;
    const response = await fetch(`/api/workflows/${selected}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(message(payload, "Could not load the video brief workflow."));
    setDetail(payload);
  };

  /** Loads the approved backlog so the operator can see the recommendation and pick an eligible topic. */
  const loadUpstream = async (workflowId: string) => {
    const response = await fetch(`/api/workflows/${workflowId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(message(payload, "Could not load the approved content backlog."));
    const run = payload.runs?.find((item: { status: string; output_payload: unknown }) => item.status === "COMPLETED" && item.output_payload);
    const parsed = run ? channelVideoBriefUpstreamSchemaSafeParse(run.output_payload) : null;
    if (parsed) setUpstream({ workflowId, runId: run.id, result: parsed });
  };

  useEffect(() => {
    let disposed = false;
    const refresh = () => load()
      .catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not load video brief workflows."); })
      .finally(() => { if (!disposed) setLoading(false); });
    void refresh();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const contentId = approvedContent?.id;
    if (!contentId) return;
    let disposed = false;
    // The approved backlog is read only to populate the topic selector; a
    // failure here must not block the rest of the workspace.
    const refresh = () => loadUpstream(contentId).catch(() => { if (!disposed) setUpstream(null); });
    void refresh();
    return () => { disposed = true; };
  }, [approvedContent?.id]);

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!upstream) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      // Only identifiers travel; the server resolves the authoritative artifact.
      const input: Record<string, string> = {
        contentIntelligenceWorkflowId: upstream.workflowId,
        contentIntelligenceRunId: upstream.runId,
      };
      if (selectedTopicId) input.topicId = selectedTopicId;
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ operation: "START_WORKFLOW", workflowType: "CHANNEL_VIDEO_BRIEF", definitionVersion: 1, input }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Could not start the video brief."));
      await load(payload.operationResult.workflowId);
      setNotice("Video brief queued from the exact approved topic. The server persisted its immutable upstream reference.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the video brief."); }
    finally { setBusy(false); }
  };

  const decide = async (decision: "APPROVE" | "REJECT" | "REQUEST_REVISION") => {
    const approval = detail?.approvals.find((item) => item.status === "PENDING");
    if (!detail || !approval) return;
    const note = decision === "REQUEST_REVISION" ? revisionNote.trim() : undefined;
    if (decision === "REQUEST_REVISION" && !note) return;
    setBusy(true); setError(null);
    try {
      const response = await fetch(`/api/workflows/${detail.workflow.id}/approvals/${approval.id}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, note }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Could not record the review decision."));
      await load(detail.workflow.id);
      if (decision === "REQUEST_REVISION") setRevisionNote("");
      setNotice(`${decision.replaceAll("_", " ")} recorded. The original brief and its lineage are preserved.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the review decision."); }
    finally { setBusy(false); }
  };

  const currentRun = detail?.runs.find((run) => run.id === detail.workflow.current_run_id) ?? detail?.runs[0];
  const brief = safeBrief(currentRun?.output_payload);
  const finalQa = safeQa(detail?.steps.find((step) => step.step_key === "final-video-brief-qa")?.output_payload);
  const pendingApproval = detail?.approvals.find((item) => item.status === "PENDING");
  const recommendation = upstream?.result.nextVideoRecommendation;

  return (
    <section className="workspace-section" aria-label="Video brief">
      <header className="workspace-header">
        <div>
          <h2>Video brief</h2>
          <p>Turn one approved backlog topic into the creative and production direction for a single video. Titles, thumbnails, scripts, and publishing remain later stages.</p>
        </div>
        <button type="button" className="button" onClick={() => load().catch(() => undefined)} disabled={busy}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </header>

      {loading && <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Loading video brief workflows…</p>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      {!approvedContent && !loading && (
        <p className="muted">Approve a content-intelligence backlog first. A video brief can only be built from an approved topic.</p>
      )}

      {approvedContent && upstream && (
        <form className="stack-form" onSubmit={start}>
          {recommendation && (
            <div className="callout">
              <strong>Recommended next video</strong>
              <p>{upstream.result.topics.find((topic) => topic.topicId === recommendation.topicId)?.workingConcept ?? recommendation.topicId}</p>
              <p className="muted">{recommendation.viewerValueRationale}</p>
            </div>
          )}
          <label>
            Topic
            <select value={selectedTopicId} onChange={(event) => setSelectedTopicId(event.target.value)} disabled={busy}>
              <option value="">Use the recommended next video</option>
              {upstream.result.backlog
                .filter((entry) => upstream.result.topics.find((topic) => topic.topicId === entry.topicId)?.viewerValue.gate === "PASS")
                .map((entry) => (
                  <option key={entry.topicId} value={entry.topicId}>
                    #{entry.rank} · {upstream.result.topics.find((topic) => topic.topicId === entry.topicId)?.workingConcept ?? entry.topicId}
                  </option>
                ))}
            </select>
          </label>
          <p className="muted">Only topics that passed the Viewer Value gate upstream are eligible. The server re-verifies the topic against the approved artifact.</p>
          <button className="button button-accent" type="submit" disabled={busy}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Start video brief
          </button>
        </form>
      )}

      {briefWorkflows.length > 0 && (
        <nav className="chip-row" aria-label="Video brief runs">
          {briefWorkflows.map((item) => (
            <button key={item.id} type="button" className={`chip ${item.id === activeId ? "chip-active" : ""}`} onClick={() => load(item.id).catch(() => undefined)}>
              {new Date(item.created_at).toLocaleDateString()} · {item.status}
            </button>
          ))}
        </nav>
      )}

      {detail && (
        <div className="detail-grid">
          <StageList steps={detail.steps.filter((step) => step.workflow_run_id === (currentRun?.id ?? ""))} />
          {currentRun?.error_code && (
            <div className="error-banner" role="alert">
              This run stopped at <code>{currentRun.error_code}</code>. No brief was advanced to review.
            </div>
          )}
        </div>
      )}

      {brief && <BriefDocument brief={brief} qa={finalQa} />}

      {brief && pendingApproval && (
        <div className="approval-panel">
          <h3>Review</h3>
          <p className="muted">Approving accepts the creative and production direction. It does not mean the video is ready to produce, export, or publish.</p>
          <label>
            Revision note
            <textarea value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} maxLength={2000}
              placeholder="What should the revised brief change?" disabled={busy} />
          </label>
          <div className="button-row">
            <button type="button" className="button button-accent" onClick={() => decide("APPROVE")} disabled={busy}><Check size={15} /> Approve</button>
            <button type="button" className="button" onClick={() => decide("REQUEST_REVISION")} disabled={busy || !revisionNote.trim()}><RefreshCcw size={15} /> Request revision</button>
            <button type="button" className="button button-danger" onClick={() => decide("REJECT")} disabled={busy}><XCircle size={15} /> Reject</button>
          </div>
        </div>
      )}
    </section>
  );
}

function StageList({ steps }: { steps: Array<{ id: string; step_key: string; status: string; attempt_count: number; max_attempts: number; error_code: string | null }> }) {
  return (
    <ol className="stage-list" aria-label="Workflow stages">
      {steps.map((step) => (
        <li key={step.id} className={`stage stage-${step.status.toLowerCase()}`}>
          <span>{step.step_key.replaceAll("-", " ")}</span>
          <span className="muted">{step.status}{step.attempt_count > 1 ? ` · attempt ${step.attempt_count}/${step.max_attempts}` : ""}</span>
          {step.error_code && <code>{step.error_code}</code>}
        </li>
      ))}
    </ol>
  );
}

/** Renders the brief as a readable creative document rather than raw JSON. */
function BriefDocument({ brief, qa }: { brief: ChannelVideoBriefResult; qa: VideoBriefQAResult | null }) {
  const researchRequired = brief.evidencePlan.items.filter((item) => item.status === "RESEARCH_REQUIRED");
  const forbidden = brief.evidencePlan.items.filter((item) => item.status === "MUST_NOT_CLAIM");
  return (
    <article className="brief-document">
      <header>
        <h3>{brief.source.workingConcept}</h3>
        <p className="muted">{brief.source.pillarName} · {brief.creativeDirection.format.replaceAll("_", " ").toLowerCase()} · {brief.creativeDirection.productionComplexity} production complexity</p>
        <div className="badge-row">
          <span className={`badge badge-${gateTone(brief.viewerValue.gate)}`}><ShieldCheck size={13} /> Viewer value {brief.viewerValue.gate}</span>
          {qa && <span className="badge">QA {qa.score}/100 · {qa.recommendation.replaceAll("_", " ")}</span>}
          <span className="badge">{brief.evidencePlan.sufficiency.replaceAll("_", " ").toLowerCase()}</span>
        </div>
      </header>

      <section>
        <h4>Viewer promise</h4>
        <p className="lead">{brief.viewerPromise.statement}</p>
        <p>{brief.viewerPromise.whyItMatters}</p>
        <dl className="pair-list">
          <div><dt>Before</dt><dd>{brief.viewerPromise.transformation.before}</dd></div>
          <div><dt>After</dt><dd>{brief.viewerPromise.transformation.after}</dd></div>
          <div><dt>Concrete value</dt><dd>{brief.viewerPromise.concreteValue}</dd></div>
        </dl>
        <h5>Deliberately not promised</h5>
        <ul>{brief.viewerPromise.explicitNonPromises.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>

      <section>
        <h4>Viewer</h4>
        <p>{brief.viewer.primaryViewer}</p>
        <p className="muted">{brief.viewer.viewerState}</p>
        <dl className="pair-list">
          <div><dt>Already knows</dt><dd><ul>{brief.viewer.alreadyKnows.map((item) => <li key={item}>{item}</li>)}</ul></dd></div>
          <div><dt>Still needs</dt><dd><ul>{brief.viewer.stillNeeds.map((item) => <li key={item}>{item}</li>)}</ul></dd></div>
        </dl>
        <p className="muted">{brief.viewer.demographicPrecisionLimit}</p>
      </section>

      <section>
        <h4>Original contribution</h4>
        <p>{brief.originalContribution.statement}</p>
        <p className="muted">Compared to existing videos: {brief.originalContribution.comparedToExisting}</p>
      </section>

      <section>
        <h4>Evidence plan</h4>
        {researchRequired.length > 0 && (
          <div className="callout callout-warning">
            <strong><AlertTriangle size={14} /> {researchRequired.length} claim{researchRequired.length === 1 ? "" : "s"} need research before scripting</strong>
            <ul>{researchRequired.map((item) => <li key={item.claimId}>{item.claim}<br /><span className="muted">{item.researchNote}</span></li>)}</ul>
          </div>
        )}
        {forbidden.length > 0 && (
          <div className="callout callout-danger">
            <strong>Must not be claimed</strong>
            <ul>{forbidden.map((item) => <li key={item.claimId}>{item.claim}</li>)}</ul>
          </div>
        )}
        <table className="data-table">
          <thead><tr><th>Claim</th><th>Status</th><th>Evidence</th></tr></thead>
          <tbody>
            {brief.evidencePlan.items.map((item) => (
              <tr key={item.claimId}>
                <td>{item.claim}</td>
                <td>{EVIDENCE_STATUS_LABEL[item.status] ?? item.status}</td>
                <td className="muted">{item.evidenceIds.length ? item.evidenceIds.join(", ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h4>Content architecture</h4>
        <p className="muted">{brief.contentArchitecture.structureRationale}</p>
        <ol className="beat-list">
          {brief.contentArchitecture.beats.map((beat) => (
            <li key={beat.sectionId}>
              <strong>{beat.title}</strong> <span className="badge badge-small">{beat.role.toLowerCase()}</span>
              <p>{beat.purpose}</p>
              <p className="muted">Answers: {beat.viewerQuestion}</p>
              <p className="muted">Delivers: {beat.valueDelivered}</p>
              <p className="muted">Retention risk: {beat.retentionRisk}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h4>Hook strategy</h4>
        <p>{brief.hookStrategy.audienceTension}</p>
        <p className="muted">Payoff: {brief.hookStrategy.expectedPayoff}</p>
        <ul>
          {brief.hookStrategy.concepts.map((concept) => (
            <li key={concept.conceptId}>{concept.approach} <span className="muted">— {concept.payoffAlignment}</span></li>
          ))}
        </ul>
      </section>

      <section>
        <h4>Creative direction</h4>
        <dl className="pair-list">
          <div><dt>Tone</dt><dd>{brief.creativeDirection.tone}</dd></div>
          <div><dt>Pacing</dt><dd>{brief.creativeDirection.pacing}</dd></div>
          <div><dt>Visual strategy</dt><dd>{brief.creativeDirection.visualStrategy}</dd></div>
          <div><dt>Credibility</dt><dd>{brief.creativeDirection.credibilityStrategy}</dd></div>
        </dl>
      </section>

      <section>
        <h4>Call to action and monetization</h4>
        <p>{brief.ctaStrategy.objective.replaceAll("_", " ").toLowerCase()} — {brief.ctaStrategy.rationale}</p>
        <p className="muted">Monetization: {brief.monetizationAlignment.relevance === "NONE" ? "none (correctly, no natural tie-in)" : brief.monetizationAlignment.relevance.replaceAll("_", " ").toLowerCase()} · {brief.monetizationAlignment.rationale}</p>
        {brief.supportingResource && (
          <p className="muted">Companion resource: {brief.supportingResource.concept} ({brief.supportingResource.pricingRecommendation.toLowerCase()})</p>
        )}
      </section>

      <section>
        <h4>Risks and assumptions</h4>
        <ul>{brief.risks.map((risk) => <li key={risk.risk}><strong>{risk.severity}</strong> — {risk.risk}</li>)}</ul>
        <h5>Assumptions</h5>
        <ul>{brief.assumptions.map((item) => <li key={item}>{item}</li>)}</ul>
        <h5>Open questions</h5>
        <ul>{brief.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>

      {brief.crossModelReview && (
        <section>
          <h4>Independent critique</h4>
          <p className="muted">
            {brief.crossModelReview.generator.provider} generated · {brief.crossModelReview.critic?.provider ?? "no"} critic · {brief.crossModelReview.outcome.replaceAll("_", " ").toLowerCase()}
          </p>
          <p>{brief.crossModelReview.summary}</p>
          <ul>{brief.crossModelReview.findings.map((finding) => <li key={`${finding.code}:${finding.affectedField}`}>{finding.affectedField}: {finding.rationale}</li>)}</ul>
        </section>
      )}

      <footer className="muted">
        Approved direction only. This brief is not a script, a title, a thumbnail, or a publishing decision.
      </footer>
    </article>
  );
}

function safeBrief(payload: unknown): ChannelVideoBriefResult | null {
  const parsed = channelVideoBriefResultSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function safeQa(payload: unknown): VideoBriefQAResult | null {
  const qa = (payload as { qa?: unknown } | null)?.qa;
  const parsed = videoBriefQAResultSchema.safeParse(qa);
  return parsed.success ? parsed.data : null;
}

/** The upstream backlog is only read to populate the topic selector. */
function channelVideoBriefUpstreamSchemaSafeParse(payload: unknown): ChannelContentIntelligenceResult | null {
  const value = payload as ChannelContentIntelligenceResult | null;
  if (!value || typeof value !== "object" || !Array.isArray(value.backlog) || !Array.isArray(value.topics)) return null;
  return value;
}
