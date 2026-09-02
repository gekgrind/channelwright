"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, RefreshCcw, ShieldCheck, Sparkles, Target, XCircle } from "lucide-react";
import {
  channelVideoPerformanceResultSchema,
  videoPerformanceQAResultSchema,
  type ChannelVideoPerformanceResult,
  type VideoPerformanceQAResult,
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
const verdictTone = (verdict: string) => verdict === "SUPPORTED" ? "done" : verdict === "REFUTED" ? "failed" : "warning";

/** An approved video-release workflow eligible to measure. */
type EligibleRelease = { workflowId: string; runId: string };

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
  const [engine, setEngine] = useState(initial);
  const [detail, setDetail] = useState<WorkflowDetail | null>(null);
  const [release, setRelease] = useState<EligibleRelease | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [revisionNote, setRevisionNote] = useState("");

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

  const performanceWorkflows = useMemo(() => engine?.workflows.filter((item) => item.workflow_type === "CHANNEL_VIDEO_PERFORMANCE") ?? [], [engine]);
  const approvedRelease = useMemo(() => engine?.workflows.find((item) => item.workflow_type === "CHANNEL_VIDEO_RELEASE" && item.status === "COMPLETED"), [engine]);
  const activeId = detail?.workflow.id ?? performanceWorkflows[0]?.id;

  const load = async (workflowId?: string) => {
    const listResponse = await fetch("/api/workflows", { cache: "no-store" });
    const listPayload = await listResponse.json();
    if (!listResponse.ok) throw new Error(message(listPayload, "Could not refresh video performance workflows."));
    setEngine(listPayload.workflowEngine);
    const selected = workflowId ?? detail?.workflow.id ?? listPayload.workflowEngine.workflows.find((item: { workflow_type: string }) => item.workflow_type === "CHANNEL_VIDEO_PERFORMANCE")?.id;
    if (!selected) return;
    const response = await fetch(`/api/workflows/${selected}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(message(payload, "Could not load the video performance workflow."));
    setDetail(payload);
  };

  /** Confirms the approved release has a completed run to measure. */
  const loadRelease = async (workflowId: string) => {
    const response = await fetch(`/api/workflows/${workflowId}`, { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) throw new Error(message(payload, "Could not load the approved video release."));
    const run = payload.runs?.find((item: { status: string; output_payload: unknown }) => item.status === "COMPLETED" && item.output_payload);
    if (run) setRelease({ workflowId, runId: run.id });
  };

  useEffect(() => {
    let disposed = false;
    const refresh = () => load()
      .catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : "Could not load video performance workflows."); })
      .finally(() => { if (!disposed) setLoading(false); });
    void refresh();
    return () => { disposed = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const releaseId = approvedRelease?.id;
    if (!releaseId) return;
    let disposed = false;
    const refresh = () => loadRelease(releaseId).catch(() => { if (!disposed) setRelease(null); });
    void refresh();
    return () => { disposed = true; };
  }, [approvedRelease?.id]);

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
    setBusy(true); setError(null); setNotice(null);
    try {
      const performanceSnapshot = {
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
      // Only identifiers plus the operator snapshot travel; the server resolves
      // the authoritative approved release.
      const input = { videoReleaseWorkflowId: release.workflowId, videoReleaseRunId: release.runId, performanceSnapshot };
      const response = await fetch("/api/workflows", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ operation: "START_WORKFLOW", workflowType: "CHANNEL_VIDEO_PERFORMANCE", definitionVersion: 1, input }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(message(payload, "Could not start the video performance measurement."));
      await load(payload.operationResult.workflowId);
      setNotice("Video performance measurement queued from the exact approved release. Your snapshot is the only untrusted input, and it is re-stamped verbatim into the record.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not start the video performance measurement."); }
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
      setNotice(`${decision.replaceAll("_", " ")} recorded. The original performance record, the operator snapshot, and their lineage are preserved.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the review decision."); }
    finally { setBusy(false); }
  };

  const currentRun = detail?.runs.find((run) => run.id === detail.workflow.current_run_id) ?? detail?.runs[0];
  const record = safeRecord(currentRun?.output_payload);
  // Scope QA to the current run: after a revision the step collection also holds
  // the predecessor run's final QA, which must not appear beside the new record.
  const finalQa = safeQa(detail?.steps.find((step) => step.workflow_run_id === currentRun?.id && step.step_key === "final-video-performance-qa")?.output_payload);
  const pendingApproval = detail?.approvals.find((item) => item.status === "PENDING");
  const canStart = release && sourceNote.trim() !== "" && windowStart !== "" && windowEnd !== "" && videoDurationSeconds.trim() !== "";

  return (
    <section className="workspace-section" aria-label="Video performance">
      <header className="workspace-header">
        <div>
          <h2>Video performance</h2>
          <p>Turn one approved video release plus a performance snapshot you enter into an immutable learning record: a verdict on every KPI hypothesis the release bound, the durable learnings, whether to revisit strategy, and the next decision. Channelwright never fetches analytics — it interprets the numbers you supply, and it never re-publishes, re-cuts, or changes the approved release.</p>
        </div>
        <button type="button" className="button" onClick={() => load().catch(() => undefined)} disabled={busy}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </header>

      {loading && <p className="muted" role="status"><LoaderCircle size={14} className="spin" /> Loading video performance workflows…</p>}
      {error && <div className="error-banner" role="alert">{error}</div>}
      {notice && <div className="notice-banner" role="status">{notice}</div>}

      {!approvedRelease && !loading && (
        <p className="muted">Approve a video release first. Performance can only be measured against an approved release.</p>
      )}

      {approvedRelease && release && (
        <form className="stack-form" onSubmit={start}>
          <p className="muted">Enter what you have from YouTube Studio (manual, CSV export, or a pasted API snapshot). Leave any metric blank if you do not have it — a hypothesis with no data is marked NOT&nbsp;ENOUGH&nbsp;DATA rather than guessed.</p>

          <div className="field-row">
            <label>Source
              <select value={measurementSource} onChange={(event) => setMeasurementSource(event.target.value as typeof measurementSource)} disabled={busy}>
                <option value="MANUAL_ENTRY">Manual entry</option>
                <option value="CSV_EXPORT">CSV export</option>
                <option value="API_SNAPSHOT_PASTED">Pasted API snapshot</option>
                <option value="OTHER">Other</option>
              </select>
            </label>
            <label>Video duration (s)
              <input type="number" min={1} value={videoDurationSeconds} onChange={(event) => setVideoDurationSeconds(event.target.value)} disabled={busy} required />
            </label>
            <label>Days since publish
              <input type="number" min={0} value={daysSincePublish} onChange={(event) => setDaysSincePublish(event.target.value)} disabled={busy} />
            </label>
          </div>

          <div className="field-row">
            <label>Observation window start
              <input type="datetime-local" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} disabled={busy} required />
            </label>
            <label>Observation window end
              <input type="datetime-local" value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} disabled={busy} required />
            </label>
          </div>

          <label>How you obtained these numbers
            <textarea value={sourceNote} onChange={(event) => setSourceNote(event.target.value)} maxLength={600} required
              placeholder="e.g. Exported the Studio 'Reach' and 'Engagement' tabs on day 14, pasted below." disabled={busy} />
          </label>

          <fieldset className="metric-grid">
            <legend>Metrics (enter what you have)</legend>
            {METRIC_FIELDS.map(([key, label]) => (
              <label key={key}>{label}
                <input type="number" value={metrics[key] ?? ""} onChange={(event) => setMetrics((prev) => ({ ...prev, [key]: event.target.value }))} disabled={busy} />
              </label>
            ))}
          </fieldset>

          <label>Context that matters for reading these numbers <span className="muted">(optional)</span>
            <textarea value={operatorContext} onChange={(event) => setOperatorContext(event.target.value)} maxLength={1200}
              placeholder="e.g. This video was featured on the channel homepage for three days; a competitor posted the same topic on day 2." disabled={busy} />
          </label>

          <button className="button button-accent" type="submit" disabled={busy || !canStart}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Start video performance measurement
          </button>
        </form>
      )}

      {performanceWorkflows.length > 0 && (
        <nav className="chip-row" aria-label="Video performance runs">
          {performanceWorkflows.map((item) => (
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
              This run stopped at <code>{currentRun.error_code}</code>. No performance record was advanced to review.
            </div>
          )}
        </div>
      )}

      {record && <PerformanceDocument record={record} qa={finalQa} />}

      {record && pendingApproval && (
        <div className="approval-panel">
          <h3>Review</h3>
          <p className="muted">Approving records the immutable performance learning record. Any strategy change it recommends is for you to act on later; approval changes nothing about the published video.</p>
          <label>
            Revision note
            <textarea value={revisionNote} onChange={(event) => setRevisionNote(event.target.value)} maxLength={2000}
              placeholder="What should the revised interpretation change?" disabled={busy} />
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
