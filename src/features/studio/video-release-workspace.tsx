"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, Clock3, LoaderCircle, RefreshCcw, ShieldCheck, Sparkles, Target, XCircle } from "lucide-react";
import {
  channelVideoReleaseResultSchema,
  videoReleaseQAResultSchema,
  type ChannelVideoReleaseResult,
  type VideoReleaseQAResult,
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

/** An approved video-packaging workflow eligible to release. */
type EligiblePackaging = { workflowId: string; runId: string };

export function VideoReleaseWorkspace({ initial }: { initial?: WorkflowList }) {
  const [engine, setEngine] = useState(initial);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [packaging, setPackaging] = useState<EligiblePackaging | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");

  const releaseWorkflows = useMemo(() => engine?.workflows.filter((item) => item.workflow_type === "CHANNEL_VIDEO_RELEASE") ?? [], [engine]);
  const approvedPackaging = useMemo(() => engine?.workflows.find((item) => item.workflow_type === "CHANNEL_VIDEO_PACKAGING" && item.status === "COMPLETED"), [engine]);
  const activeId = detail?.workflow.id ?? releaseWorkflows[0]?.id;

  const load = async (workflowId?: string) => {
    const listResponse = await fetch("/api/workflows", { cache: "no-store" });
    const listPayload = await listResponse.json();
    if (!listResponse.ok) throw new Error(message(listPayload, "Could not refresh video release workflows."));
    setEngine(listPayload.workflowEngine);
    const selected = workflowId ?? detail?.workflow.id ?? listPayload.workflowEngine.workflows.find((item: { workflow_type: string }) => item.workflow_type === "CHANNEL_VIDEO_RELEASE")?.id;
    if (!selected) return;
    const response = await fetch(`/api/workflows/${selected}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(message(payload, "Could not load the video release workflow."));
    setDetail(payload);
  };

  /** Confirms the approved packaging has a completed run to release. */
  const loadPackaging = async (workflowId: string) => {
    const response = await fetch(`/api/workflows/${workflowId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(message(payload, "Could not load the approved video packaging."));
    const run = payload.runs?.find((item: { status: string; output_payload: unknown }) => item.status === "COMPLETED" && item.output_payload);
    if (run) setPackaging({ workflowId, runId: run.id });
  };

  useEffect(() => {
    let disposed = false;
    const refresh = () => load()
      .catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not load video release workflows."); })
      .finally(() => { if (!disposed) setLoading(false); });
    void refresh();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const packagingId = approvedPackaging?.id;
    if (!packagingId) return;
    let disposed = false;
    const refresh = () => loadPackaging(packagingId).catch(() => { if (!disposed) setPackaging(null); });
    void refresh();
    return () => { disposed = true; };
  }, [approvedPackaging?.id]);

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!packaging) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      // Only identifiers travel; the server resolves the authoritative packaging.
      const input = { videoPackagingWorkflowId: packaging.workflowId, videoPackagingRunId: packaging.runId };
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ operation: "START_WORKFLOW", workflowType: "CHANNEL_VIDEO_RELEASE", definitionVersion: 1, input }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Could not start the video release."));
      await load(payload.operationResult.workflowId);
      setNotice("Video release queued from the exact approved packaging. The server persisted its immutable upstream reference.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the video release."); }
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
      setNotice(`${decision.replaceAll("_", " ")} recorded. The original release record and its lineage are preserved.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the review decision."); }
    finally { setBusy(false); }
  };

  const currentRun = detail?.runs.find((run) => run.id === detail.workflow.current_run_id) ?? detail?.runs[0];
  const release = safeRelease(currentRun?.output_payload);
  // Scope QA to the current run: after a revision the step collection also holds
  // the predecessor run's final QA, which must not appear beside the new release.
  const finalQa = safeQa(detail?.steps.find((step) => step.workflow_run_id === currentRun?.id && step.step_key === "final-video-release-qa")?.output_payload);
  const pendingApproval = detail?.approvals.find((item) => item.status === "PENDING");

  return (
    <section className="workspace-section" aria-label="Video release">
      <header className="workspace-header">
        <div>
          <h2>Video release</h2>
          <p>Turn one approved video packaging into an immutable release decision: the selected title and thumbnail, a recommended publish window, playlist and distribution intent, reconciled metadata, and the KPI hypotheses this release tests. This records the decision only — it does not publish, schedule, or upload anything.</p>
        </div>
        <button type="button" className="button" onClick={() => load().catch(() => undefined)} disabled={busy}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </header>

      {loading && <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Loading video release workflows…</p>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      {!approvedPackaging && !loading && (
        <p className="muted">Approve a video packaging first. A release can only be decided from approved packaging.</p>
      )}

      {approvedPackaging && packaging && (
        <form className="stack-form" onSubmit={start}>
          <p className="muted">The release inherits the approved packaging promise, its title candidates and thumbnail concepts, and its evidence. The server re-verifies the approved packaging before any release is written.</p>
          <button className="button button-accent" type="submit" disabled={busy}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Start video release
          </button>
        </form>
      )}

      {releaseWorkflows.length > 0 && (
        <nav className="chip-row" aria-label="Video release runs">
          {releaseWorkflows.map((item) => (
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
              This run stopped at <code>{currentRun.error_code}</code>. No release was advanced to review.
            </div>
          )}
        </div>
      )}

      {release && <ReleaseDocument release={release} qa={finalQa} />}

      {release && pendingApproval && (
        <div className="approval-panel">
          <h3>Review</h3>
          <p className="muted">Approving records the final release decision. It does not publish, schedule, upload, or generate anything.</p>
          <label>
            Revision note
            <textarea value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} maxLength={2000}
              placeholder="What should the revised release change?" disabled={busy} />
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

/** Renders the release record as a readable document rather than raw JSON. */
function ReleaseDocument({ release, qa }: { release: ChannelVideoReleaseResult; qa: VideoReleaseQAResult | null }) {
  return (
    <article className="brief-document">
      <header>
        <h3>{release.source.workingConcept}</h3>
        <p className="muted">
          {release.source.pillarName} · {release.distributionSurfaces.length} distribution surfaces · {release.kpiHypothesisBindings.length} KPI hypotheses
        </p>
        <div className="badge-row">
          <span className={`badge badge-${gateTone(release.viewerValue.gate)}`}><ShieldCheck size={13} /> Viewer value {release.viewerValue.gate}</span>
          <span className={`badge badge-${release.releaseIntegrity.misleadingGuardOutcome === "PASS" ? "done" : "failed"}`}>Deception guard {release.releaseIntegrity.misleadingGuardOutcome}</span>
          {qa && <span className="badge">QA {qa.score}/100 · {qa.recommendation.replaceAll("_", " ")}</span>}
        </div>
      </header>

      <section>
        <h4>Promise this release keeps</h4>
        <p className="lead">{release.source.releasePromise}</p>
      </section>

      <section>
        <h4>Selected title <span className="muted">(chosen from the approved candidates)</span></h4>
        <p className="lead">&ldquo;{release.titleDecision.selectedTitleText}&rdquo; <span className="badge badge-small">deception {release.titleDecision.deceptionRisk}</span></p>
        <p className="muted">{release.titleDecision.rationale}</p>
        <p className="muted">Keeps the promise: {release.titleDecision.promiseAlignment}</p>
      </section>

      <section>
        <h4>Selected thumbnail concept</h4>
        <p className="muted"><strong>{release.thumbnailDecision.selectedConceptId}</strong> <span className="badge badge-small">deception {release.thumbnailDecision.deceptionRisk}</span></p>
        <p className="muted">{release.thumbnailDecision.rationale}</p>
      </section>

      <section>
        <h4>Recommended publish window <Clock3 size={12} /> <span className="muted">(intent only — nothing is scheduled)</span></h4>
        <p>{new Date(release.publishWindow.earliest).toLocaleString()} → {new Date(release.publishWindow.latest).toLocaleString()} ({release.publishWindow.timezone})</p>
        <p className="muted">{release.publishWindow.rationale}</p>
      </section>

      <section>
        <h4>Playlist / series placement</h4>
        <p>{[release.playlistPlacement.seriesName, release.playlistPlacement.playlistName].filter(Boolean).join(" · ") || "No series or playlist"}</p>
        <p className="muted">{release.playlistPlacement.placementRationale}</p>
      </section>

      <section>
        <h4>Distribution surfaces <span className="muted">(plan only)</span></h4>
        <ul>{release.distributionSurfaces.map((surface) => <li key={`${surface.surface}:${surface.intent}`}><strong>{surface.surface.replaceAll("_", " ").toLowerCase()}</strong> — {surface.intent} <span className="badge badge-small">{surface.viewerValueImpact}</span></li>)}</ul>
      </section>

      <section>
        <h4>Reconciled metadata</h4>
        <p className="lead">{release.reconciledMetadata.finalTitle}</p>
        <p>{release.reconciledMetadata.finalDescription.summary}</p>
        <div className="tag-list">{release.reconciledMetadata.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        <ol className="beat-list">
          {[...release.reconciledMetadata.chapters].sort((a, b) => a.startSeconds - b.startSeconds).map((chapter) => (
            <li key={chapter.chapterId}><strong>{formatTimestamp(chapter.startSeconds)}</strong> {chapter.title}</li>
          ))}
        </ol>
      </section>

      <section>
        <h4>KPI hypotheses this release tests <Target size={12} /> <span className="muted">(intent only — measurement is a later stage)</span></h4>
        <ul>{release.kpiHypothesisBindings.map((binding) => <li key={`${binding.metric}:${binding.label}`}><strong>{binding.metric.replaceAll("_", " ").toLowerCase()}</strong> — {binding.hypothesis}</li>)}</ul>
      </section>

      <section>
        <h4>Release integrity</h4>
        <p className="muted">{release.releaseIntegrity.summary}</p>
        {release.releaseIntegrity.rejectedForDeception.length > 0 && (
          <ul>{release.releaseIntegrity.rejectedForDeception.map((item) => <li key={item}>{item}</li>)}</ul>
        )}
      </section>

      <section>
        <h4>Risks and assumptions</h4>
        <ul>{release.risks.map((risk) => <li key={risk.risk}><strong>{risk.severity}</strong> — {risk.risk}</li>)}</ul>
        <h5>Open questions</h5>
        <ul>{release.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>

      {release.crossModelReview && (
        <section>
          <h4>Independent critique</h4>
          <p className="muted">
            {release.crossModelReview.generator.provider} generated · {release.crossModelReview.critic?.provider ?? "no"} critic · {release.crossModelReview.outcome.replaceAll("_", " ").toLowerCase()}
          </p>
          <p>{release.crossModelReview.summary}</p>
          <ul>{release.crossModelReview.findings.map((finding) => <li key={`${finding.code}:${finding.affectedField}`}>{finding.affectedField}: {finding.rationale}</li>)}</ul>
        </section>
      )}

      <footer className="muted">
        Approved release decision only. This does not publish, schedule, upload, render, or generate anything; publishing and measurement remain later stages.
      </footer>
    </article>
  );
}

function safeRelease(payload: unknown): ChannelVideoReleaseResult | null {
  const parsed = channelVideoReleaseResultSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function safeQa(payload: unknown): VideoReleaseQAResult | null {
  const qa = (payload as { qa?: unknown } | null)?.qa;
  const parsed = videoReleaseQAResultSchema.safeParse(qa);
  return parsed.success ? parsed.data : null;
}
