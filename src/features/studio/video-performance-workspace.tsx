"use client";

import { FormEvent, useState } from "react";
import { LoaderCircle, RefreshCcw, ShieldCheck, Sparkles, Target } from "lucide-react";
import {
  channelVideoPerformanceResultSchema,
  videoPerformanceQAResultSchema,
  type ChannelVideoPerformanceResult,
  type VideoPerformanceQAResult,
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
const verdictTone = (verdict: string) => verdict === "SUPPORTED" ? "done" : verdict === "REFUTED" ? "failed" : "warning";

/** The exact approved release run a performance snapshot was entered for. */
type DraftOwner = { workflowId: string; runId: string; title: string };

/** The operator-entered metric fields. Every one is optional: the operator supplies what they have. */
const METRIC_FIELDS = [
  ["impressions", "Impressions", "int"],
  ["views", "Views", "int"],
  ["uniqueViewers", "Unique viewers", "int"],
  ["clickThroughRatePct", "CTR %", "num"],
  ["averageViewDurationSeconds", "Avg view duration (s)", "int"],
  ["averagePercentageViewedPct", "Avg % viewed", "num"],
  ["watchTimeHours", "Watch time (hours)", "num"],
  ["subscribersGained", "Subscribers gained", "int"],
  ["subscribersLost", "Subscribers lost", "int"],
  ["likes", "Likes", "int"],
  ["comments", "Comments", "int"],
  ["shares", "Shares", "int"],
  ["returningViewersPct", "Returning viewers %", "num"],
  ["estimatedRevenueUsdIndicator", "Revenue indicator (USD, actual)", "num"],
] as const;

export function VideoPerformanceWorkspace({ initial }: { initial?: WorkflowList }) {
  const workspace = useWorkflowWorkspace<WorkflowDetail>({ initial, workflowType: "CHANNEL_VIDEO_PERFORMANCE", label: "video performance" });
  const { detail, currentRun, decisionTarget, busy } = workspace;
  const selection = useApprovedUpstream({
    engine: workspace.engine,
    workflowType: "CHANNEL_VIDEO_RELEASE",
    label: "video release",
    parse: parseObjectPayload,
    describe: describeVideoArtifact("Approved video release"),
  });
  const release = selection.upstream;

  // Operator snapshot form state. Numbers are kept as raw strings so an empty
  // field submits as null rather than 0.
  const [metrics, setMetrics] = useState<Record<string, string>>({});
  const [sourceNote, setSourceNote] = useState("");
  const [measurementSource, setMeasurementSource] = useState<"MANUAL_ENTRY" | "CSV_EXPORT" | "API_SNAPSHOT_PASTED" | "OTHER">("MANUAL_ENTRY");
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [daysSincePublish, setDaysSincePublish] = useState("");
  const [videoDurationSeconds, setVideoDurationSeconds] = useState("");
  const [operatorContext, setOperatorContext] = useState("");
  // The snapshot is evidence about one exact approved release run. It is bound
  // to that run on first edit and never follows a different selection silently.
  const [draftOwner, setDraftOwner] = useState<DraftOwner | null>(null);
  const draftMismatch = Boolean(draftOwner && (selection.selectedId !== draftOwner.workflowId || (release && release.runId !== draftOwner.runId)));
  const editable = Boolean(release) && !busy && !draftMismatch;
  /** Wraps every field change so the draft is bound to the release it was entered for. */
  const edit = <T,>(apply: (value: T) => void) => (value: T) => {
    if (!release || draftMismatch) return;
    if (!draftOwner) setDraftOwner({ workflowId: release.workflowId, runId: release.runId, title: release.title });
    apply(value);
  };
  const clearDraft = () => {
    setMetrics({}); setSourceNote(""); setMeasurementSource("MANUAL_ENTRY"); setWindowStart(""); setWindowEnd("");
    setDaysSincePublish(""); setVideoDurationSeconds(""); setOperatorContext(""); setDraftOwner(null);
  };
  const ownerStillEligible = Boolean(draftOwner && selection.eligible.some((item) => item.id === draftOwner.workflowId));

  const numeric = (raw: string | undefined, kind: "int" | "num"): number | null => {
    const trimmed = (raw ?? "").trim();
    if (trimmed === "") return null;
    const value = Number(trimmed);
    if (!Number.isFinite(value)) return null;
    return kind === "int" ? Math.trunc(value) : value;
  };

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!release) return;
    // Verify, at send time, that the snapshot was entered for this exact release run.
    if (!draftOwner || draftMismatch || draftOwner.workflowId !== release.workflowId || draftOwner.runId !== release.runId) {
      workspace.setError("Nothing was started: this snapshot was entered for a different release. Switch back, re-bind it explicitly, or clear it.");
      return;
    }
    let performanceSnapshot: Record<string, unknown>;
    try {
      performanceSnapshot = {
        measurementSource,
        sourceNote: sourceNote.trim(),
        capturedAt: new Date().toISOString(),
        observationWindow: {
          start: new Date(windowStart).toISOString(),
          end: new Date(windowEnd).toISOString(),
          daysSincePublish: numeric(daysSincePublish, "int") ?? 0,
        },
        videoDurationSeconds: numeric(videoDurationSeconds, "int") ?? 0,
        metrics: Object.fromEntries(METRIC_FIELDS.map(([key, , kind]) => [key, numeric(metrics[key], kind)])),
        // ponytail: no operator-baseline editor in v1 — an empty baseline set keeps
        // every hypothesis at INCONCLUSIVE / NOT_ENOUGH_DATA, the safe default.
        // Add a baseline editor when operators need SUPPORTED/REFUTED verdicts.
        operatorBaselines: [],
        operatorContext: operatorContext.trim() === "" ? null : operatorContext.trim(),
      };
    } catch {
      workspace.setError("The observation window is not a valid date range.");
      return;
    }
    // Only identifiers plus the operator snapshot travel; the server resolves
    // the authoritative approved release.
    await workspace.start(
      { videoReleaseWorkflowId: release.workflowId, videoReleaseRunId: release.runId, performanceSnapshot },
      "Video performance measurement queued from the exact approved release. Your snapshot is the only untrusted input, and it is re-stamped verbatim into the record.",
    );
  };

  const record = safeRecord(currentRun?.output_payload);
  // Scope QA to the current run: after a revision the step collection also holds
  // the predecessor run's final QA, which must not appear beside the new record.
  const finalQa = safeQa(detail?.steps.find((step) => step.workflow_run_id === currentRun?.id && step.step_key === "final-video-performance-qa")?.output_payload);
  const version = detail && currentRun ? runVersionOf(detail, currentRun.id) : undefined;
  const canStart = release && !draftMismatch && sourceNote.trim() !== "" && windowStart !== "" && windowEnd !== "" && videoDurationSeconds.trim() !== "";

  return (
    <section className="workspace-section" aria-label="Video performance">
      <header className="workspace-header">
        <div>
          <h2>Video performance</h2>
          <p>Turn one approved video release plus a performance snapshot you enter into an immutable learning record: a verdict on every KPI hypothesis the release bound, the durable learnings, whether to revisit strategy, and the next decision. Channelwright never fetches analytics — it interprets the numbers you supply, and it never re-publishes, re-cuts, or changes the approved release.</p>
        </div>
        <button type="button" className="button" onClick={() => void workspace.refresh()} disabled={busy}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </header>

      <WorkspaceFeedback label="video performance" loading={workspace.loading || workspace.switching} busy={busy} error={workspace.error} refreshError={workspace.refreshError} notice={workspace.notice} polling={workspace.polling} onRetry={() => void workspace.refresh()} />

      {selection.eligible.length === 0 && !workspace.loading && (
        <p className="muted">Approve a video release first. Performance can only be measured against an approved release.</p>
      )}

      {selection.eligible.length > 0 && (
        <form className="stack-form" onSubmit={start}>
          <UpstreamCard heading="Measure performance for" kindLabel="Release" selection={selection} disabled={busy} />
          {draftOwner && draftMismatch && (
            <div className="callout callout-warning" role="alert">
              <strong>This snapshot was entered for “{draftOwner.title}”</strong>
              <p>The numbers below have not been applied to the release now selected. Nothing can be started until you choose what they belong to.</p>
              <div className="button-row">
                {ownerStillEligible && <button type="button" className="button" onClick={() => { workspace.setError(null); selection.choose(draftOwner.workflowId); }}>Switch back to “{draftOwner.title}”</button>}
                {release && <button type="button" className="button" onClick={() => { workspace.setError(null); setDraftOwner({ workflowId: release.workflowId, runId: release.runId, title: release.title }); }}>Use these numbers for “{release.title}”</button>}
                <button type="button" className="button button-danger" onClick={() => { workspace.setError(null); clearDraft(); }}>Clear the snapshot</button>
              </div>
            </div>
          )}
          <p className="muted">Enter what you have from YouTube Studio (manual, CSV export, or a pasted API snapshot). Leave any metric blank if you do not have it — a hypothesis with no data is marked NOT&nbsp;ENOUGH&nbsp;DATA rather than guessed.</p>

          <div className="field-row">
            <label>Source
              <select value={measurementSource} onChange={(event) => edit(setMeasurementSource)(event.target.value as typeof measurementSource)} disabled={!editable}>
                <option value="MANUAL_ENTRY">Manual entry</option>
                <option value="CSV_EXPORT">CSV export</option>
                <option value="API_SNAPSHOT_PASTED">Pasted API snapshot</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label>Video duration (s)
              <input type="number" min={1} value={videoDurationSeconds} onChange={(event) => edit(setVideoDurationSeconds)(event.target.value)} disabled={!editable} required />
            </label>
            <label>Days since publish
              <input type="number" min={0} value={daysSincePublish} onChange={(event) => edit(setDaysSincePublish)(event.target.value)} disabled={!editable} />
            </label>
          </div>

          <div className="field-row">
            <label>Observation window start
              <input type="datetime-local" value={windowStart} onChange={(event) => edit(setWindowStart)(event.target.value)} disabled={!editable} required />
            </label>
            <label>Observation window end
              <input type="datetime-local" value={windowEnd} onChange={(event) => edit(setWindowEnd)(event.target.value)} disabled={!editable} required />
            </label>
          </div>

          <label>How you obtained these numbers
            <textarea value={sourceNote} onChange={(event) => edit(setSourceNote)(event.target.value)} maxLength={600} required
              placeholder="e.g. Exported the Studio 'Reach' and 'Engagement' tabs on day 14, pasted below." disabled={!editable} />
          </label>

          <fieldset className="metric-grid">
            <legend>Metrics (enter what you have)</legend>
            {METRIC_FIELDS.map(([key, label]) => (
              <label key={key}>{label}
                <input type="number" value={metrics[key] ?? ""} onChange={(event) => edit((value: string) => setMetrics((prev) => ({ ...prev, [key]: value })))(event.target.value)} disabled={!editable} />
              </label>
            ))}
          </fieldset>

          <label>Context that matters for reading these numbers <span className="muted">(optional)</span>
            <textarea value={operatorContext} onChange={(event) => edit(setOperatorContext)(event.target.value)} maxLength={1200}
              placeholder="e.g. This video was featured on the channel homepage for three days; a competitor posted the same topic on day 2." disabled={!editable} />
          </label>

          <button className="button button-accent" type="submit" disabled={busy || !canStart}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Start video performance measurement
          </button>
        </form>
      )}

      <RunChips label="Video performance runs" workflows={workspace.workflows} activeId={workspace.activeId} disabled={busy} onSelect={workspace.select} />

      {detail && (
        <div className="detail-grid">
          <StageList steps={detail.steps.filter((step) => step.workflow_run_id === (currentRun?.id ?? ""))} />
          {currentRun?.error_code && (
            <div className="error-banner" role="alert">
              This run stopped at <code>{currentRun.error_code}</code>. No performance record was advanced to review.
            </div>
          )}
        </div>
      )}

      {record && <PerformanceDocument record={record} qa={finalQa} />}

      {record && decisionTarget && (
        <DecisionBar
          target={decisionTarget}
          busy={busy}
          title="Review this performance record"
          explanation="Approving records the immutable performance learning record. Any strategy change it recommends is for you to act on later; approval changes nothing about the published video."
          versionLabel={version ? `Performance record v${version}` : undefined}
          approveLabel="Approve exact version"
          revisionPlaceholder="What should the revised interpretation change?"
          artifactLabel="performance record"
          onDecide={(target, decision, note) => workspace.decide(target, decision, note, `${decision.replaceAll("_", " ")} recorded. The original performance record, the operator snapshot, and their lineage are preserved.`)}
        />
      )}
    </section>
  );
}

/** Renders the performance learning record as a readable document rather than raw JSON. */
function PerformanceDocument({ record, qa }: { record: ChannelVideoPerformanceResult; qa: VideoPerformanceQAResult | null }) {
  return (
    <article className="brief-document">
      <header>
        <h3>{record.source.workingConcept}</h3>
        <p className="muted">
          {record.source.pillarName} · {record.kpiHypothesisOutcomes.length} hypotheses adjudicated · snapshot coverage {record.snapshotIntegrity.coverage}
        </p>
        <div className="badge-row">
          <span className={`badge badge-${gateTone(record.viewerValue.gate)}`}><ShieldCheck size={13} /> Viewer value {record.viewerValue.gate}</span>
          <span className={`badge badge-${record.measurementIntegrity.fabricationGuardOutcome === "PASS" ? "done" : "failed"}`}>Fabrication guard {record.measurementIntegrity.fabricationGuardOutcome}</span>
          {qa && <span className="badge">QA {qa.score}/100 · {qa.recommendation.replaceAll("_", " ")}</span>}
        </div>
      </header>

      <section>
        <h4>Promise the measured video kept</h4>
        <p className="lead">{record.source.releasePromise}</p>
      </section>

      <section>
        <h4>What happened</h4>
        <p>{record.performanceSummary}</p>
      </section>

      <section>
        <h4>KPI / hypothesis verdicts <Target size={12} /></h4>
        <ul>{record.kpiHypothesisOutcomes.map((outcome) => (
          <li key={`${outcome.binding.metric}:${outcome.binding.label}`}>
            <span className={`badge badge-small badge-${verdictTone(outcome.verdict)}`}>{outcome.verdict.replaceAll("_", " ")}</span>{" "}
            <strong>{outcome.binding.label}</strong> — {outcome.interpretation}
            {outcome.observedValue !== null && <span className="muted"> (observed {outcome.metricObserved.replaceAll("_", " ").toLowerCase()}: {outcome.observedValue})</span>}
          </li>
        ))}</ul>
      </section>

      <section>
        <h4>Durable learnings</h4>
        <ul>{record.learnings.map((learning) => (
          <li key={learning.observation}>
            <strong>{learning.category.replaceAll("_", " ").toLowerCase()}</strong> — {learning.observation}
            {learning.changesAnAssumption && <span className="muted"> · updates a prior assumption: {learning.updatedUnderstanding}</span>}
          </li>
        ))}</ul>
      </section>

      <section>
        <h4>Strategy signal <span className="muted">(recommendation only — nothing is changed for you)</span></h4>
        <p className="lead">{record.strategyRevisitSignal.recommendation.replaceAll("_", " ")}</p>
        <p className="muted">{record.strategyRevisitSignal.rationale}</p>
      </section>

      <section>
        <h4>Next decision <span className="muted">(recommendation only)</span></h4>
        <p className="lead">{record.nextDecision.decision}</p>
        <p className="muted">{record.nextDecision.rationale}</p>
      </section>

      <section>
        <h4>Snapshot integrity</h4>
        <p className="muted">{record.measurementIntegrity.summary}</p>
        {record.snapshotIntegrity.consistencyNotes.length > 0 && (
          <ul>{record.snapshotIntegrity.consistencyNotes.map((note) => <li key={note}>{note}</li>)}</ul>
        )}
      </section>

      <section>
        <h4>Risks and open questions</h4>
        <ul>{record.risks.map((risk) => <li key={risk.risk}><strong>{risk.severity}</strong> — {risk.risk}</li>)}</ul>
        <h5>Open questions</h5>
        <ul>{record.openQuestions.map((item) => <li key={item}>{item}</li>)}</ul>
      </section>

      {record.crossModelReview && (
        <section>
          <h4>Independent critique</h4>
          <p className="muted">
            {record.crossModelReview.generator.provider} generated · {record.crossModelReview.critic?.provider ?? "no"} critic · {record.crossModelReview.outcome.replaceAll("_", " ").toLowerCase()}
          </p>
          <p>{record.crossModelReview.summary}</p>
          <ul>{record.crossModelReview.findings.map((finding) => <li key={`${finding.code}:${finding.affectedField}`}>{finding.affectedField}: {finding.rationale}</li>)}</ul>
        </section>
      )}

      <footer className="muted">
        Immutable performance learning record. Channelwright fetched nothing: it interpreted the operator-supplied snapshot only, and it did not re-publish, re-cut, schedule, render, or change the approved release.
      </footer>
    </article>
  );
}

function safeRecord(payload: unknown): ChannelVideoPerformanceResult | null {
  const parsed = channelVideoPerformanceResultSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}

function safeQa(payload: unknown): VideoPerformanceQAResult | null {
  const qa = (payload as { qa?: unknown } | null)?.qa;
  const parsed = videoPerformanceQAResultSchema.safeParse(qa);
  return parsed.success ? parsed.data : null;
}
