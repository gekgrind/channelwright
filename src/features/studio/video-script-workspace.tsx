"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, Clock3, LoaderCircle, RefreshCcw, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import {
  channelVideoScriptResultSchema,
  videoScriptQAResultSchema,
  type ChannelVideoScriptResult,
  type VideoScriptQAResult,
} from "@/domain/production-workflows";
import type { ViewerValueGate } from "@/domain/viewer-value";
import type { WorkflowList } from "./channel-research-workspace";

type WorkflowDetail = {
  workflow: { id: string; status: string; created_at: string; current_run_id: string };
  runs: Array<{ id: string; status: string; input_payload: Record<string, unknown>; context_payload: Record<string, unknown>; output_payload: unknown; error_code: string | null; artifact_hash: string | null; provenance_hash: string | null }>;
  steps: Array<{ id: string; workflow_run_id: string; step_key: string; status: string; output_payload: unknown; attempt_count: number; max_attempts: number; error_code: string | null }>;
  approvals: Array<{ id: string; workflow_run_id: string; status: string; decision_note: string | null; requested_at: string; decided_at: string | null }>;
};

function message(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") return error.message;
  return fallback;
}

const gateTone = (gate: ViewerValueGate) => gate === "PASS" ? "done" : gate === "REVISE" ? "warning" : "failed";

const TREATMENT_LABEL: Record<string, string> = {
  ASSERTED_AS_FACT: "Asserted as fact",
  PRESENTED_AS_HYPOTHESIS: "Presented as hypothesis",
  ATTRIBUTED: "Attributed",
  HEDGED: "Hedged",
  OMITTED: "Omitted",
};

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
};

/** An approved video-brief workflow eligible to script. */
type EligibleBrief = { workflowId: string; runId: string };

export function VideoScriptWorkspace({ initial }: { initial?: WorkflowList }) {
  const [engine, setEngine] = useState(initial);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [brief, setBrief] = useState<EligibleBrief | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");

  const scriptWorkflows = useMemo(() => engine?.workflows.filter((item) => item.workflow_type === "CHANNEL_VIDEO_SCRIPT") ?? [], [engine]);
  const approvedBrief = useMemo(() => engine?.workflows.find((item) => item.workflow_type === "CHANNEL_VIDEO_BRIEF" && item.status === "COMPLETED"), [engine]);
  const activeId = detail?.workflow.id ?? scriptWorkflows[0]?.id;

  const load = async (workflowId?: string) => {
    const listResponse = await fetch("/api/workflows", { cache: "no-store" });
    const listPayload = await listResponse.json();
    if (!listResponse.ok) throw new Error(message(listPayload, "Could not refresh video script workflows."));
    setEngine(listPayload.workflowEngine);
    const selected = workflowId ?? detail?.workflow.id ?? listPayload.workflowEngine.workflows.find((item: { workflow_type: string }) => item.workflow_type === "CHANNEL_VIDEO_SCRIPT")?.id;
    if (!selected) return;
    const response = await fetch(`/api/workflows/${selected}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(message(payload, "Could not load the video script workflow."));
    setDetail(payload);
  };

  /** Confirms the approved brief has a completed run to script. */
  const loadBrief = async (workflowId: string) => {
    const response = await fetch(`/api/workflows/${workflowId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(message(payload, "Could not load the approved video brief."));
    const run = payload.runs?.find((item: { status: string; output_payload: unknown }) => item.status === "COMPLETED" && item.output_payload);
    if (run) setBrief({ workflowId, runId: run.id });
  };

  useEffect(() => {
    let disposed = false;
    const refresh = () => load()
      .catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not load video script workflows."); })
      .finally(() => { if (!disposed) setLoading(false); });
    void refresh();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const briefId = approvedBrief?.id;
    if (!briefId) return;
    let disposed = false;
    const refresh = () => loadBrief(briefId).catch(() => { if (!disposed) setBrief(null); });
    void refresh();
    return () => { disposed = true; };
  }, [approvedBrief?.id]);

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!brief) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      // Only identifiers travel; the server resolves the authoritative brief.
      const input = { videoBriefWorkflowId: brief.workflowId, videoBriefRunId: brief.runId };
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ operation: "START_WORKFLOW", workflowType: "CHANNEL_VIDEO_SCRIPT", definitionVersion: 1, input }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Could not start the video script."));
      await load(payload.operationResult.workflowId);
      setNotice("Video script queued from the exact approved brief. The server persisted its immutable upstream reference.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the video script."); }
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
      setNotice(`${decision.replaceAll("_", " ")} recorded. The original script and its lineage are preserved.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the review decision."); }
    finally { setBusy(false); }
  };

  const currentRun = detail?.runs.find((run) => run.id === detail.workflow.current_run_id) ?? detail?.runs[0];
  const script = safeScript(currentRun?.output_payload);
  const finalQa = safeQa(detail?.steps.find((step) => step.step_key === "final-video-script-qa")?.output_payload);
  const pendingApproval = detail?.approvals.find((item) => item.status === "PENDING");

  return (
    <section className="workspace-section" aria-label="Video script">
      <header className="workspace-header">
        <div>
          <h2>Video script</h2>
          <p>Turn one approved video brief into a structured, timed, evidence-disciplined script. Titles, thumbnails, media generation, and publishing remain later stages.</p>
        </div>
        <button type="button" className="button" onClick={() => load().catch(() => undefined)} disabled={busy}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </header>

      {loading && <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Loading video script workflows…</p>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      {!approvedBrief && !loading && (
        <p className="muted">Approve a video brief first. A video script can only be written from an approved brief.</p>
      )}

      {approvedBrief && brief && (
        <form className="stack-form" onSubmit={start}>
          <p className="muted">The script inherits the approved brief promise, content architecture, and evidence plan. The server re-verifies the approved brief before any script is written.</p>
          <button className="button button-accent" type="submit" disabled={busy}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Start video script
          </button>
        </form>
      )}

      {scriptWorkflows.length > 0 && (
        <nav className="chip-row" aria-label="Video script runs">
          {scriptWorkflows.map((item) => (
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
              This run stopped at <code>{currentRun.error_code}</code>. No script was advanced to review.
            </div>
          )}
        </div>
      )}

      {script && <ScriptDocument script={script} qa={finalQa} />}

      {script && pendingApproval && (
        <div className="approval-panel">
          <h3>Review</h3>
          <p className="muted">Approving accepts the script. It does not mean the video is ready to package, render, or publish.</p>
          <label>
            Revision note
            <textarea value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} maxLength={2000}
              placeholder="What should the revised script change?" disabled={busy} />
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

/** Renders the script as a readable document rather than raw JSON. */
function ScriptDocument({ script, qa }: { script: ChannelVideoScriptResult; qa: VideoScriptQAResult | null }) {
  const deferred = script.claimUsage.filter((item) => item.inheritedStatus === "RESEARCH_REQUIRED" || item.inheritedStatus === "MUST_NOT_CLAIM");
  return (
    <article className="brief-document">
      <header>
        <h3>{script.source.workingConcept}</h3>
        <p className="muted">
          {script.source.pillarName} · {script.sections.length} sections · <Clock3 size={12} /> {formatDuration(script.timing.totalDurationSeconds)} · ~{script.timing.estimatedWordCount} words
        </p>
        <div className="badge-row">
          <span className={`badge badge-${gateTone(script.viewerValue.gate)}`}><ShieldCheck size={13} /> Viewer value {script.viewerValue.gate}</span>
          {qa && <span className="badge">QA {qa.score}/100 · {qa.recommendation.replaceAll("_", " ")}</span>}
        </div>
      </header>

      <section>
        <h4>Promise this script keeps</h4>
        <p className="lead">{script.source.scriptedPromise}</p>
      </section>

      <section>
        <h4>Opening hook</h4>
        <p className="lead">{script.openingHook.spokenOpening}</p>
        {script.openingHook.onScreenText && <p className="muted">On screen: {script.openingHook.onScreenText}</p>}
        <p className="muted">{formatDuration(script.openingHook.durationSeconds)} · {script.openingHook.curiosityMechanism} · deception risk {script.openingHook.deceptionRisk}</p>
      </section>

      <section>
        <h4>Script</h4>
        <ol className="beat-list">
          {script.sections.map((section) => (
            <li key={section.sectionId}>
              <strong>{section.title}</strong> <span className="badge badge-small">{section.role.toLowerCase()}</span>{" "}
              <span className="muted">{formatDuration(section.startSeconds)}–{formatDuration(section.startSeconds + section.durationSeconds)} · maps to {section.briefBeatId}</span>
              <p>{section.narration}</p>
              {section.onScreenText && <p className="muted">On screen: {section.onScreenText}</p>}
              {section.visualDirection && <p className="muted">Visual: {section.visualDirection}</p>}
              <p className="muted">Delivers: {section.deliversValue}</p>
              {section.evidenceIds.length > 0 && <p className="muted">Evidence: {section.evidenceIds.join(", ")}</p>}
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h4>Evidence discipline</h4>
        <p className="muted">{script.evidenceDiscipline.summary}</p>
        {deferred.length > 0 && (
          <table className="data-table">
            <thead><tr><th>Claim</th><th>Inherited status</th><th>Treatment</th></tr></thead>
            <tbody>
              {deferred.map((item) => (
                <tr key={item.claimId}>
                  <td>{item.claimId}</td>
                  <td>{item.inheritedStatus.replaceAll("_", " ").toLowerCase()}</td>
                  <td>{TREATMENT_LABEL[item.treatment] ?? item.treatment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h4>Call to action</h4>
        <p>{script.callToAction.objective.replaceAll("_", " ").toLowerCase()}{script.callToAction.spokenCta ? ` — "${script.callToAction.spokenCta}"` : ""}</p>
      </section>

      <section>
        <h4>Risks and assumptions</h4>
        <ul>{script.risks.map((risk) => <li key={risk.risk}><strong>{risk.severity}</strong> — {risk.risk}</li>)}</ul>
        <h5>Open questions</h5>
        <ul>{script.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>

      {script.crossModelReview && (
        <section>
          <h4>Independent critique</h4>
          <p className="muted">
            {script.crossModelReview.generator.provider} generated · {script.crossModelReview.critic?.provider ?? "no"} critic · {script.crossModelReview.outcome.replaceAll("_", " ").toLowerCase()}
          </p>
          <p>{script.crossModelReview.summary}</p>
          <ul>{script.crossModelReview.findings.map((finding) => <li key={`${finding.code}:${finding.affectedField}`}>{finding.affectedField}: {finding.rationale}</li>)}</ul>
        </section>
      )}

      <footer className="muted">
        Approved script only. This is not a title, a thumbnail, generated media, or a publishing decision.
      </footer>
    </article>
  );
}

function safeScript(payload: unknown): ChannelVideoScriptResult | null {
  const parsed = channelVideoScriptResultSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function safeQa(payload: unknown): VideoScriptQAResult | null {
  const qa = (payload as { qa?: unknown } | null)?.qa;
  const parsed = videoScriptQAResultSchema.safeParse(qa);
  return parsed.success ? parsed.data : null;
}
