"use client";

import type { FormEvent } from "react";
import { Clock3, LoaderCircle, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import {
  channelVideoPackagingResultSchema,
  videoPackagingQAResultSchema,
  type ChannelVideoPackagingResult,
  type VideoPackagingQAResult,
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

export function VideoPackagingWorkspace({ initial }: { initial?: WorkflowList }) {
  const workspace = useWorkflowWorkspace<WorkflowDetail>({ initial, workflowType: "CHANNEL_VIDEO_PACKAGING", label: "video packaging" });
  const { detail, currentRun, pendingApproval, busy } = workspace;
  const selection = useApprovedUpstream({
    engine: workspace.engine,
    workflowType: "CHANNEL_VIDEO_SCRIPT",
    label: "video script",
    parse: parseObjectPayload,
    describe: describeVideoArtifact("Approved video script"),
  });
  const approvedScript = selection.upstream;

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!approvedScript) return;
    // Only identifiers travel; the server resolves the authoritative script.
    await workspace.start({ videoScriptWorkflowId: approvedScript.workflowId, videoScriptRunId: approvedScript.runId }, "Video packaging queued from the exact approved script. The server persisted its immutable upstream reference.");
  };

  const packaging = safePackaging(currentRun?.output_payload);
  // Scope QA to the current run: after a revision the step collection also holds
  // the predecessor run's final QA, which must not appear beside the new record.
  const finalQa = safeQa(detail?.steps.find((step) => step.workflow_run_id === currentRun?.id && step.step_key === "final-video-packaging-qa")?.output_payload);
  const version = detail && currentRun ? runVersionOf(detail, currentRun.id) : undefined;

  return (
    <section className="workspace-section" aria-label="Video packaging">
      <header className="workspace-header">
        <div>
          <h2>Video packaging</h2>
          <p>Turn one approved video script into provider-neutral packaging: title candidates, thumbnail concepts, a description, chapters from the script timing, tags, and an end-screen plan. Choosing a title, generating the thumbnail image, and publishing remain later stages.</p>
        </div>
        <button type="button" className="button" onClick={() => void workspace.refresh()} disabled={busy}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </header>

      <WorkspaceFeedback label="video packaging" loading={workspace.loading} busy={busy} error={workspace.error} refreshError={workspace.refreshError} notice={workspace.notice} polling={workspace.polling} onRetry={() => void workspace.refresh()} />

      {selection.eligible.length === 0 && !workspace.loading && (
        <p className="muted">Approve a video script first. Packaging can only be built from an approved script.</p>
      )}

      {selection.eligible.length > 0 && (
        <form className="stack-form" onSubmit={start}>
          <UpstreamCard heading="Create packaging from" kindLabel="Script" selection={selection} disabled={busy} />
          <p className="muted">The packaging inherits the approved script promise, structure, timing, and evidence. The server re-verifies the approved script before any packaging is written.</p>
          <button className="button button-accent" type="submit" disabled={busy || !approvedScript}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Start video packaging
          </button>
        </form>
      )}

      <RunChips label="Video packaging runs" workflows={workspace.workflows} activeId={workspace.activeId} disabled={busy} onSelect={workspace.select} />

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
        <DecisionBar
          busy={busy}
          title="Review this packaging"
          explanation="Approving accepts the packaging direction. It does not choose a title, generate a thumbnail, or publish anything."
          versionLabel={version ? `Packaging v${version}` : undefined}
          approveLabel="Approve exact version"
          revisionPlaceholder="What should the revised packaging change?"
          artifactLabel="packaging"
          onDecide={(decision, note) => workspace.decide(decision, note, `${decision.replaceAll("_", " ")} recorded. The original packaging and its lineage are preserved.`)}
        />
      )}
    </section>
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
