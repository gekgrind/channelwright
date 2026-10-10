"use client";

import type { FormEvent } from "react";
import { Clock3, LoaderCircle, RefreshCcw, ShieldCheck, Sparkles, Target } from "lucide-react";
import {
  channelVideoReleaseResultSchema,
  videoReleaseQAResultSchema,
  type ChannelVideoReleaseResult,
  type VideoReleaseQAResult,
} from "@/domain/production-workflows";
import type { ViewerValueGate } from "@/domain/viewer-value";
import type { WorkflowList } from "./workflow-api";
import { runVersionOf } from "./workflow-api";
import { useWorkflowWorkspace } from "./use-workflow-workspace";
import { describeVideoArtifact, parseObjectPayload, UpstreamCard, useApprovedUpstream } from "./upstream-selection";
import { DecisionBar, RunChips, StageList, WorkspaceFeedback } from "./workflow-controls";

type WorkflowDetail = {
  workflow: { id: string; status: string; created_at: string; current_run_id: string };
  runs: Array<{ id: string; status: string; input_payload: Record<string, unknown>; context_payload: Record<string, unknown>; output_payload: unknown; error_code: string | null; artifact_hash: string | null; provenance_hash: string | null; created_at?: string; completed_at?: string | null }>;
  steps: Array<{ id: string; workflow_run_id: string; step_key: string; status: string; output_payload: unknown; attempt_count: number; max_attempts: number; error_code: string | null }>;
  approvals: Array<{ id: string; workflow_run_id: string; status: string; decision_note: string | null; requested_at: string; decided_at: string | null }>;
};

const gateTone = (gate: ViewerValueGate) => gate === "PASS" ? "done" : gate === "REVISE" ? "warning" : "failed";

const formatTimestamp = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
};

export function VideoReleaseWorkspace({ initial }: { initial?: WorkflowList }) {
  const workspace = useWorkflowWorkspace<WorkflowDetail>({ initial, workflowType: "CHANNEL_VIDEO_RELEASE", label: "video release" });
  const { detail, currentRun, pendingApproval, busy } = workspace;
  const selection = useApprovedUpstream({
    engine: workspace.engine,
    workflowType: "CHANNEL_VIDEO_PACKAGING",
    label: "video packaging",
    parse: parseObjectPayload,
    describe: describeVideoArtifact("Approved video packaging"),
  });
  const approvedPackaging = selection.upstream;

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!approvedPackaging) return;
    // Only identifiers travel; the server resolves the authoritative packaging.
    await workspace.start({ videoPackagingWorkflowId: approvedPackaging.workflowId, videoPackagingRunId: approvedPackaging.runId }, "Video release queued from the exact approved packaging. The server persisted its immutable upstream reference.");
  };

  const release = safeRelease(currentRun?.output_payload);
  // Scope QA to the current run: after a revision the step collection also holds
  // the predecessor run's final QA, which must not appear beside the new record.
  const finalQa = safeQa(detail?.steps.find((step) => step.workflow_run_id === currentRun?.id && step.step_key === "final-video-release-qa")?.output_payload);
  const version = detail && currentRun ? runVersionOf(detail, currentRun.id) : undefined;

  return (
    <section className="workspace-section" aria-label="Video release">
      <header className="workspace-header">
        <div>
          <h2>Video release</h2>
          <p>Turn one approved video packaging into an immutable release decision: the selected title and thumbnail, a recommended publish window, playlist and distribution intent, reconciled metadata, and the KPI hypotheses this release tests. This records the decision only — it does not publish, schedule, or upload anything.</p>
        </div>
        <button type="button" className="button" onClick={() => void workspace.refresh()} disabled={busy}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </header>

      <WorkspaceFeedback label="video release" loading={workspace.loading} busy={busy} error={workspace.error} refreshError={workspace.refreshError} notice={workspace.notice} polling={workspace.polling} onRetry={() => void workspace.refresh()} />

      {selection.eligible.length === 0 && !workspace.loading && (
        <p className="muted">Approve a video packaging first. A release can only be decided from approved packaging.</p>
      )}

      {selection.eligible.length > 0 && (
        <form className="stack-form" onSubmit={start}>
          <UpstreamCard heading="Decide a release from" kindLabel="Packaging" selection={selection} disabled={busy} />
          <p className="muted">The release inherits the approved packaging promise, its title candidates and thumbnail concepts, and its evidence. The server re-verifies the approved packaging before any release is written.</p>
          <button className="button button-accent" type="submit" disabled={busy || !approvedPackaging}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Start video release
          </button>
        </form>
      )}

      <RunChips label="Video release runs" workflows={workspace.workflows} activeId={workspace.activeId} disabled={busy} onSelect={workspace.select} />

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
        <DecisionBar
          busy={busy}
          title="Review this release decision"
          explanation="Approving records the final release decision. It does not publish, schedule, upload, or generate anything."
          versionLabel={version ? `Release v${version}` : undefined}
          approveLabel="Approve exact version"
          revisionPlaceholder="What should the revised release change?"
          artifactLabel="release"
          onDecide={(decision, note) => workspace.decide(decision, note, `${decision.replaceAll("_", " ")} recorded. The original release record and its lineage are preserved.`)}
        />
      )}
    </section>
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
