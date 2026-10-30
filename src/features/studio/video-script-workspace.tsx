"use client";

import type { FormEvent } from "react";
import { Clock3, LoaderCircle, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import {
  channelVideoScriptResultSchema,
  videoScriptQAResultSchema,
  type ChannelVideoScriptResult,
  type VideoScriptQAResult,
} from "@/domain/production-workflows";
import type { ViewerValueGate } from "@/domain/viewer-value";
import type { WorkflowList } from "./workflow-api";
import { runVersionOf } from "./workflow-api";
import { useWorkflowWorkspace } from "./use-workflow-workspace";
import { describeVideoArtifact, parseObjectPayload, UpstreamCard, useApprovedUpstream } from "./upstream-selection";
import { RunChips, StageList, WorkspaceFeedback } from "./workflow-controls";
import { ReviewScreen } from "./review-screen";

type WorkflowDetail = {
  workflow: { id: string; status: string; created_at: string; current_run_id: string };
  runs: Array<{ id: string; status: string; input_payload: Record<string, unknown>; context_payload: Record<string, unknown>; output_payload: unknown; error_code: string | null; artifact_hash: string | null; provenance_hash: string | null; created_at?: string; completed_at?: string | null }>;
  steps: Array<{ id: string; workflow_run_id: string; step_key: string; status: string; output_payload: unknown; attempt_count: number; max_attempts: number; error_code: string | null }>;
  approvals: Array<{ id: string; workflow_run_id: string; status: string; decision_note: string | null; requested_at: string; decided_at: string | null }>;
};

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

export function VideoScriptWorkspace({ initial }: { initial?: WorkflowList }) {
  const workspace = useWorkflowWorkspace<WorkflowDetail>({ initial, workflowType: "CHANNEL_VIDEO_SCRIPT", label: "video script" });
  const { detail, currentRun, decisionTarget, busy } = workspace;
  const selection = useApprovedUpstream({
    engine: workspace.engine,
    workflowType: "CHANNEL_VIDEO_BRIEF",
    label: "video brief",
    parse: parseObjectPayload,
    describe: describeVideoArtifact("Approved video brief"),
  });
  const brief = selection.upstream;

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!brief) return;
    // Only identifiers travel; the server resolves the authoritative brief.
    await workspace.start({ videoBriefWorkflowId: brief.workflowId, videoBriefRunId: brief.runId }, "Video script queued from the exact approved brief. The server persisted its immutable upstream reference.");
  };

  const script = safeScript(currentRun?.output_payload);
  // Scope QA to the current run: after a revision the step collection also holds
  // the predecessor run's final QA, which must not appear beside the new script.
  const finalQa = safeQa(detail?.steps.find((step) => step.workflow_run_id === currentRun?.id && step.step_key === "final-video-script-qa")?.output_payload);
  const version = detail && currentRun ? runVersionOf(detail, currentRun.id) : undefined;

  return (
    <section className="workspace-section" aria-label="Video script">
      <header className="workspace-header">
        <div>
          <h2>Video script</h2>
          <p>Turn one approved video brief into a structured, timed, evidence-disciplined script. Titles, thumbnails, media generation, and publishing remain later stages.</p>
        </div>
        <button type="button" className="button" onClick={() => void workspace.refresh()} disabled={busy}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </header>

      <WorkspaceFeedback label="video script" loading={workspace.loading || workspace.switching} busy={busy} error={workspace.error} refreshError={workspace.refreshError} notice={workspace.notice} polling={workspace.polling} onRetry={() => void workspace.refresh()} noticeFocusKey={workspace.noticeFocusKey} />

      {selection.eligible.length === 0 && !workspace.loading && (
        <p className="muted">Approve a video brief first. A video script can only be written from an approved brief.</p>
      )}

      {selection.eligible.length > 0 && (
        <form className="stack-form" onSubmit={start}>
          <UpstreamCard heading="Write a script from" kindLabel="Brief" selection={selection} disabled={busy} />
          <p className="muted">The script inherits the approved brief promise, content architecture, and evidence plan. The server re-verifies the approved brief before any script is written.</p>
          <button className="button button-accent" type="submit" disabled={busy || !brief}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Start video script
          </button>
        </form>
      )}

      <RunChips label="Video script runs" workflows={workspace.workflows} activeId={workspace.activeId} disabled={busy} onSelect={workspace.select} />

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

      {script && decisionTarget && (
        <ReviewScreen
          target={decisionTarget}
          kind="CHANNEL_VIDEO_SCRIPT"
          busy={busy}
          title="Review this script"
          explanation="Approving accepts the script. It does not mean the video is ready to package, render, or publish."
          versionNumber={version}
          revisionPlaceholder="What should the revised script change?"
          locked={workspace.decisionLocked}
          onReload={workspace.reload}
          onDecide={(target, decision, note) => workspace.decide(target, decision, note, `${decision.replaceAll("_", " ")} recorded. The original script and its lineage are preserved.`)}
        />
      )}
    </section>
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
