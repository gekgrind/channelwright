"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, Clock3, LoaderCircle, RefreshCcw, ShieldCheck, Sparkles, XCircle } from "lucide-react";
import {
  channelVideoPackagingResultSchema,
  videoPackagingQAResultSchema,
  type ChannelVideoPackagingResult,
  type VideoPackagingQAResult,
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

const formatTimestamp = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
};

/** An approved video-script workflow eligible to package. */
type EligibleScript = { workflowId: string; runId: string };

export function VideoPackagingWorkspace({ initial }: { initial?: WorkflowList }) {
  const [engine, setEngine] = useState(initial);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [script, setScript] = useState<EligibleScript | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");

  const packagingWorkflows = useMemo(() => engine?.workflows.filter((item) => item.workflow_type === "CHANNEL_VIDEO_PACKAGING") ?? [], [engine]);
  const approvedScript = useMemo(() => engine?.workflows.find((item) => item.workflow_type === "CHANNEL_VIDEO_SCRIPT" && item.status === "COMPLETED"), [engine]);
  const activeId = detail?.workflow.id ?? packagingWorkflows[0]?.id;

  const load = async (workflowId?: string) => {
    const listResponse = await fetch("/api/workflows", { cache: "no-store" });
    const listPayload = await listResponse.json();
    if (!listResponse.ok) throw new Error(message(listPayload, "Could not refresh video packaging workflows."));
    setEngine(listPayload.workflowEngine);
    const selected = workflowId ?? detail?.workflow.id ?? listPayload.workflowEngine.workflows.find((item: { workflow_type: string }) => item.workflow_type === "CHANNEL_VIDEO_PACKAGING")?.id;
    if (!selected) return;
    const response = await fetch(`/api/workflows/${selected}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(message(payload, "Could not load the video packaging workflow."));
    setDetail(payload);
  };

  /** Confirms the approved script has a completed run to package. */
  const loadScript = async (workflowId: string) => {
    const response = await fetch(`/api/workflows/${workflowId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(message(payload, "Could not load the approved video script."));
    const run = payload.runs?.find((item: { status: string; output_payload: unknown }) => item.status === "COMPLETED" && item.output_payload);
    if (run) setScript({ workflowId, runId: run.id });
  };

  useEffect(() => {
    let disposed = false;
    const refresh = () => load()
      .catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not load video packaging workflows."); })
      .finally(() => { if (!disposed) setLoading(false); });
    void refresh();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const scriptId = approvedScript?.id;
    if (!scriptId) return;
    let disposed = false;
    const refresh = () => loadScript(scriptId).catch(() => { if (!disposed) setScript(null); });
    void refresh();
    return () => { disposed = true; };
  }, [approvedScript?.id]);

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!script) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      // Only identifiers travel; the server resolves the authoritative script.
      const input = { videoScriptWorkflowId: script.workflowId, videoScriptRunId: script.runId };
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ operation: "START_WORKFLOW", workflowType: "CHANNEL_VIDEO_PACKAGING", definitionVersion: 1, input }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Could not start the video packaging."));
      await load(payload.operationResult.workflowId);
      setNotice("Video packaging queued from the exact approved script. The server persisted its immutable upstream reference.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the video packaging."); }
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
      setNotice(`${decision.replaceAll("_", " ")} recorded. The original packaging and its lineage are preserved.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the review decision."); }
    finally { setBusy(false); }
  };

  const currentRun = detail?.runs.find((run) => run.id === detail.workflow.current_run_id) ?? detail?.runs[0];
  const packaging = safePackaging(currentRun?.output_payload);
  // Scope QA to the current run: after a revision the step collection also holds
  // the predecessor run's final QA, which must not appear beside the new packaging.
  const finalQa = safeQa(detail?.steps.find((step) => step.workflow_run_id === currentRun?.id && step.step_key === "final-video-packaging-qa")?.output_payload);
  const pendingApproval = detail?.approvals.find((item) => item.status === "PENDING");

  return (
    <section className="workspace-section" aria-label="Video packaging">
      <header className="workspace-header">
        <div>
          <h2>Video packaging</h2>
          <p>Turn one approved video script into provider-neutral packaging: title candidates, thumbnail concepts, a description, chapters from the script timing, tags, and an end-screen plan. Choosing a title, generating the thumbnail image, and publishing remain later stages.</p>
        </div>
        <button type="button" className="button" onClick={() => load().catch(() => undefined)} disabled={busy}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </header>

      {loading && <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Loading video packaging workflows…</p>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      {!approvedScript && !loading && (
        <p className="muted">Approve a video script first. Packaging can only be built from an approved script.</p>
      )}

      {approvedScript && script && (
        <form className="stack-form" onSubmit={start}>
          <p className="muted">The packaging inherits the approved script promise, structure, timing, and evidence. The server re-verifies the approved script before any packaging is written.</p>
          <button className="button button-accent" type="submit" disabled={busy}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Start video packaging
          </button>
        </form>
      )}

      {packagingWorkflows.length > 0 && (
        <nav className="chip-row" aria-label="Video packaging runs">
          {packagingWorkflows.map((item) => (
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
              This run stopped at <code>{currentRun.error_code}</code>. No packaging was advanced to review.
            </div>
          )}
        </div>
      )}

      {packaging && <PackagingDocument packaging={packaging} qa={finalQa} />}

      {packaging && pendingApproval && (
        <div className="approval-panel">
          <h3>Review</h3>
          <p className="muted">Approving accepts the packaging direction. It does not choose a title, generate a thumbnail, or publish anything.</p>
          <label>
            Revision note
            <textarea value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} maxLength={2000}
              placeholder="What should the revised packaging change?" disabled={busy} />
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

/** Renders the packaging as a readable document rather than raw JSON. */
function PackagingDocument({ packaging, qa }: { packaging: ChannelVideoPackagingResult; qa: VideoPackagingQAResult | null }) {
  return (
    <article className="brief-document">
      <header>
        <h3>{packaging.source.workingConcept}</h3>
        <p className="muted">
          {packaging.source.pillarName} · {packaging.titleCandidates.length} title candidates · {packaging.thumbnailConcepts.length} thumbnail concepts · {packaging.chapters.length} chapters
        </p>
        <div className="badge-row">
          <span className={`badge badge-${gateTone(packaging.viewerValue.gate)}`}><ShieldCheck size={13} /> Viewer value {packaging.viewerValue.gate}</span>
          {qa && <span className="badge">QA {qa.score}/100 · {qa.recommendation.replaceAll("_", " ")}</span>}
        </div>
      </header>

      <section>
        <h4>Promise this packaging keeps</h4>
        <p className="lead">{packaging.source.packagedPromise}</p>
      </section>

      <section>
        <h4>Title candidates <span className="muted">(candidates only — no selection)</span></h4>
        <ol className="beat-list">
          {packaging.titleCandidates.map((candidate) => (
            <li key={candidate.candidateId}>
              <strong>{candidate.text}</strong> <span className="badge badge-small">deception {candidate.deceptionRisk}</span>
              <p className="muted">{candidate.angle}</p>
              <p className="muted">Keeps the promise: {candidate.promiseAlignment}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h4>Thumbnail concepts <span className="muted">(copy + visual intent — no generated image)</span></h4>
        <ol className="beat-list">
          {packaging.thumbnailConcepts.map((concept) => (
            <li key={concept.conceptId}>
              {concept.copyText && <strong>&ldquo;{concept.copyText}&rdquo;</strong>} <span className="badge badge-small">deception {concept.deceptionRisk}</span>
              <p>{concept.visualIntent}</p>
              <p className="muted">Keeps the promise: {concept.promiseAlignment}</p>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h4>Chapters <Clock3 size={12} /> <span className="muted">derived from the approved script timing</span></h4>
        <ol className="beat-list">
          {[...packaging.chapters].sort((a, b) => a.startSeconds - b.startSeconds).map((chapter) => (
            <li key={chapter.chapterId}>
              <strong>{formatTimestamp(chapter.startSeconds)}</strong> {chapter.title}
              <span className="muted"> · from {chapter.sourceScriptSectionId}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h4>Description</h4>
        <p className="lead">{packaging.description.summary}</p>
        <p>{packaging.description.body}</p>
      </section>

      <section>
        <h4>Tags</h4>
        <div className="tag-list">{packaging.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
      </section>

      <section>
        <h4>End-screen / CTA plan</h4>
        <p>{packaging.endScreenPlan.ctaObjective.replaceAll("_", " ").toLowerCase()} — {packaging.endScreenPlan.rationale}</p>
        <ul>{packaging.endScreenPlan.elements.map((element) => <li key={`${element.kind}:${element.placement}`}><strong>{element.kind.replaceAll("_", " ").toLowerCase()}</strong> — {element.placement} ({element.viewerBenefit})</li>)}</ul>
      </section>

      <section>
        <h4>Packaging integrity</h4>
        <p className="muted">{packaging.packagingIntegrity.summary}</p>
        {packaging.packagingIntegrity.rejectedForDeception.length > 0 && (
          <ul>{packaging.packagingIntegrity.rejectedForDeception.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
      </section>

      <section>
        <h4>Risks and assumptions</h4>
        <ul>{packaging.risks.map((risk) => <li key={risk.risk}><strong>{risk.severity}</strong> — {risk.risk}</li>)}</ul>
        <h5>Open questions</h5>
        <ul>{packaging.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>

      {packaging.crossModelReview && (
        <section>
          <h4>Independent critique</h4>
          <p className="muted">
            {packaging.crossModelReview.generator.provider} generated · {packaging.crossModelReview.critic?.provider ?? "no"} critic · {packaging.crossModelReview.outcome.replaceAll("_", " ").toLowerCase()}
          </p>
          <p>{packaging.crossModelReview.summary}</p>
          <ul>{packaging.crossModelReview.findings.map((finding) => <li key={`${finding.code}:${finding.affectedField}`}>{finding.affectedField}: {finding.rationale}</li>)}</ul>
        </section>
      )}

      <footer className="muted">
        Approved packaging direction only. This does not choose a title, generate a thumbnail image, or publish the video.
      </footer>
    </article>
  );
}

function safePackaging(payload: unknown): ChannelVideoPackagingResult | null {
  const parsed = channelVideoPackagingResultSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function safeQa(payload: unknown): VideoPackagingQAResult | null {
  const qa = (payload as { qa?: unknown } | null)?.qa;
  const parsed = videoPackagingQAResultSchema.safeParse(qa);
  return parsed.success ? parsed.data : null;
}
