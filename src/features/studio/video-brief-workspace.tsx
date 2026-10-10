"use client";

import { FormEvent, useState } from "react";
import { AlertTriangle, LoaderCircle, RefreshCcw, ShieldCheck, Sparkles } from "lucide-react";
import {
  channelVideoBriefResultSchema,
  videoBriefQAResultSchema,
  type ChannelContentIntelligenceResult,
  type ChannelVideoBriefResult,
  type VideoBriefQAResult,
} from "@/domain/production-workflows";
import type { ViewerValueGate } from "@/domain/viewer-value";
import type { WorkflowList } from "./workflow-api";
import { runVersionOf } from "./workflow-api";
import { useWorkflowWorkspace } from "./use-workflow-workspace";
import { UpstreamCard, useApprovedUpstream } from "./upstream-selection";
import { DecisionBar, RunChips, StageList, WorkspaceFeedback } from "./workflow-controls";

type WorkflowDetail = {
  workflow: { id: string; status: string; created_at: string; current_run_id: string };
  runs: Array<{ id: string; status: string; input_payload: Record<string, unknown>; context_payload: Record<string, unknown>; output_payload: unknown; error_code: string | null; artifact_hash: string | null; provenance_hash: string | null; created_at?: string; completed_at?: string | null }>;
  steps: Array<{ id: string; workflow_run_id: string; step_key: string; status: string; output_payload: unknown; attempt_count: number; max_attempts: number; error_code: string | null }>;
  approvals: Array<{ id: string; workflow_run_id: string; status: string; decision_note: string | null; requested_at: string; decided_at: string | null }>;
  researchBudgets: Array<{ workflow_run_id: string; parent_run_id: string | null; root_run_id: string; used_totals: Record<string, number>; provider_identities: string[]; model_identities: string[]; exhaustion_code: string | null }>;
};

const gateTone = (gate: ViewerValueGate) => gate === "PASS" ? "done" : gate === "REVISE" ? "warning" : "failed";

const EVIDENCE_STATUS_LABEL: Record<string, string> = {
  SUPPORTED: "Supported",
  STRATEGIC_ASSUMPTION: "Strategic assumption",
  PRODUCTION_ASSUMPTION: "Production assumption",
  RESEARCH_REQUIRED: "Research required",
  MUST_NOT_CLAIM: "Must not claim",
};

/** The recommended topic's working concept names the approved backlog in plain language. */
export function describeContentBacklog(result: ChannelContentIntelligenceResult) {
  const next = result.topics.find((topic) => topic.topicId === result.nextVideoRecommendation.topicId);
  return { title: next ? `Backlog led by “${next.workingConcept}”` : "Approved content backlog", detail: `${result.backlog.length} ranked topics` };
}

export function VideoBriefWorkspace({ initial }: { initial?: WorkflowList }) {
  const workspace = useWorkflowWorkspace<WorkflowDetail>({ initial, workflowType: "CHANNEL_VIDEO_BRIEF", label: "video brief" });
  const { detail, currentRun, pendingApproval, busy } = workspace;
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const selection = useApprovedUpstream({
    engine: workspace.engine,
    workflowType: "CHANNEL_CONTENT_INTELLIGENCE",
    label: "content backlog",
    parse: channelVideoBriefUpstreamSchemaSafeParse,
    describe: describeContentBacklog,
  });
  const upstream = selection.upstream;

  const start = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!upstream) return;
    // Only identifiers travel; the server resolves the authoritative artifact.
    const input: Record<string, string> = {
      contentIntelligenceWorkflowId: upstream.workflowId,
      contentIntelligenceRunId: upstream.runId,
    };
    if (selectedTopicId) input.topicId = selectedTopicId;
    await workspace.start(input, "Video brief queued from the exact approved topic. The server persisted its immutable upstream reference.");
  };

  const brief = safeBrief(currentRun?.output_payload);
  // Scope QA to the current run so a predecessor's QA never appears beside a successor brief.
  const finalQa = safeQa(detail?.steps.find((step) => step.workflow_run_id === currentRun?.id && step.step_key === "final-video-brief-qa")?.output_payload);
  const recommendation = upstream?.output.nextVideoRecommendation;
  const version = detail && currentRun ? runVersionOf(detail, currentRun.id) : undefined;

  return (
    <section className="workspace-section" aria-label="Video brief">
      <header className="workspace-header">
        <div>
          <h2>Video brief</h2>
          <p>Turn one approved backlog topic into the creative and production direction for a single video. Titles, thumbnails, scripts, and publishing remain later stages.</p>
        </div>
        <button type="button" className="button" onClick={() => void workspace.refresh()} disabled={busy}>
          <RefreshCcw size={15} /> Refresh
        </button>
      </header>

      <WorkspaceFeedback label="video brief" loading={workspace.loading} busy={busy} error={workspace.error} refreshError={workspace.refreshError} notice={workspace.notice} polling={workspace.polling} onRetry={() => void workspace.refresh()} />

      {selection.eligible.length === 0 && !workspace.loading && (
        <p className="muted">Approve a content-intelligence backlog first. A video brief can only be built from an approved topic.</p>
      )}

      {selection.eligible.length > 0 && (
        <form className="stack-form" onSubmit={start}>
          <UpstreamCard heading="Create a video brief from" kindLabel="Backlog" selection={selection} disabled={busy} />
          {upstream && recommendation && (
            <div className="callout">
              <strong>Recommended next video</strong>
              <p>{upstream.output.topics.find((topic) => topic.topicId === recommendation.topicId)?.workingConcept ?? recommendation.topicId}</p>
              <p className="muted">{recommendation.viewerValueRationale}</p>
            </div>
          )}
          {upstream && (
            <>
              <label>
                Topic
                <select value={selectedTopicId} onChange={(event) => setSelectedTopicId(event.target.value)} disabled={busy}>
                  <option value="">Use the recommended next video</option>
                  {upstream.output.backlog
                    .filter((entry) => upstream.output.topics.find((topic) => topic.topicId === entry.topicId)?.viewerValue.gate === "PASS")
                    .map((entry) => (
                      <option key={entry.topicId} value={entry.topicId}>
                        #{entry.rank} · {upstream.output.topics.find((topic) => topic.topicId === entry.topicId)?.workingConcept ?? entry.topicId}
                      </option>
                    ))}
                </select>
              </label>
              <p className="muted">Only topics that passed the Viewer Value gate upstream are eligible. The server re-verifies the topic against the approved artifact.</p>
            </>
          )}
          <button className="button button-accent" type="submit" disabled={busy || !upstream}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Sparkles size={15} />} Start video brief
          </button>
        </form>
      )}

      <RunChips label="Video brief runs" workflows={workspace.workflows} activeId={workspace.activeId} disabled={busy} onSelect={workspace.select} />

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
        <DecisionBar
          busy={busy}
          title="Review this brief"
          explanation="Approving accepts the creative and production direction. It does not mean the video is ready to produce, export, or publish."
          versionLabel={version ? `Brief v${version}` : undefined}
          approveLabel="Approve exact version"
          revisionPlaceholder="What should the revised brief change?"
          artifactLabel="brief"
          onDecide={(decision, note) => workspace.decide(decision, note, `${decision.replaceAll("_", " ")} recorded. The original brief and its lineage are preserved.`)}
        />
      )}
    </section>
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
