import {
  channelVideoPerformanceResultSchema,
  operatorPerformanceSnapshotSchema,
  videoPerformanceQAResultSchema,
  type ApprovedVideoReleaseArtifact,
  type ChannelVideoPerformanceResult,
  type KpiHypothesisOutcome,
  type OperatorPerformanceSnapshot,
  type ReleasedVideoKpiBindingIdentity,
  type VideoPerformanceQAResult,
} from "@/domain/production-workflows";
import { deterministicViewerValueGate, resolveViewerValueGate } from "@/domain/viewer-value";
import { canonicalEquals } from "./canonical-json";
import { hasConsistentEvidenceIdentity, mergeSemanticQAFindings } from "./evidence-qa";
import type { ModelUsage } from "./openai-research-model";
import type { VideoPerformanceSemanticQAOutput } from "./video-performance-model";

type Finding = VideoPerformanceQAResult["findings"][number];

/** Deterministic rule count used to report a checks-passed figure. */
export const DETERMINISTIC_VIDEO_PERFORMANCE_RULE_COUNT = 44;

const FABRICATED_REVENUE = /\b(?:cpm|rpm)\b\s*(?:of|is|=|:)?\s*\$?\d|\b(?:earn|earning|earnings|make|makes|making|generate|generates|generating|projected?\s+revenue|forecast(?:ed)?\s+revenue)\b[^.]{0,40}\$\s*\d|\$\s*\d[\d,.]*\s*(?:\/|per\s+|a\s+)?(?:month|mo|year|yr|day)\b[^.]{0,40}\b(?:projected|forecast|expected|estimated\s+future)\b/i;
const FABRICATED_SEARCH_VOLUME = /\b(?:search(?:es)?\s+volume|monthly\s+searches|searched\s+\d[\d,.]*\s*times|\d[\d,.]*\s*(?:monthly\s+)?searches)\b/i;
const MONETARY_GUARANTEE = /\bguarantee(?:d|s)?\b[^.]{0,60}\$\s*\d|\bmake\s+\$\s*\d[\d,.]*\s*(?:\/|per\s+|a\s+)?(?:month|week|day|year)\b|\brisk[-\s]free\s+(?:income|profit)\b/i;

/**
 * A "benchmark" or "industry average" figure the operator did not supply. The
 * record may DISCUSS the operator's own baselines, so the pattern requires a
 * generic-population qualifier (industry / category / typical / average /
 * benchmark) sitting next to a metric name and a number.
 */
const FABRICATED_BENCHMARK = /\b(?:industry|category|niche|typical|average|benchmark|norm|standard|most\s+channels?|comparable\s+channels?)\b[^.]{0,40}\b(?:ctr|click-?through|retention|avd|average\s+view\s+duration|watch\s+time|rpm|cpm|views?|impressions?|subscribers?)\b[^.]{0,25}\b(?:is|are|of|around|about|sits?\s+at|runs?\s+at|~|:)?\s*\d/i;

/** A forward-looking performance prediction about a future video or upload. */
const FORWARD_PREDICTION = /\b(?:next|the\s+following|future|upcoming|our\s+next)\s+(?:video|upload|release)s?\b[^.]{0,50}\b(?:will|should|is\s+going\s+to|expect(?:ed)?\s+to|projected?\s+to|likely\s+to)\b[^.]{0,30}\b(?:get|reach|hit|earn|do|see|drive|pull)\b|\bwill\s+(?:get|reach|hit|earn)\b[^.]{0,25}\b\d[\d,.]*\s*(?:k|m|%|views?|subscribers?|impressions?)\b/i;

/**
 * Any attempt to ingest, fetch, or call an analytics source. This stage
 * INTERPRETS an operator-supplied snapshot and never retrieves data itself.
 */
const ANALYTICS_INGESTION = /\b(?:ingest|ingests|ingesting|fetch|fetches|pull|pulls|retrieve|retrieves|sync|syncs|scrape|scrapes|call|calls|query|queries|poll|polls)\b[^.]{0,40}\b(?:youtube\s+analytics|analytics\s+api|youtube\s+data\s+api|studio\s+api|reporting\s+api|the\s+api|analytics\s+endpoint)\b|\byoutube\s+analytics\s+api\b|\banalytics\s+ingestion\b|\bauto(?:matically)?\s+(?:pull|fetch|import|sync)\s+(?:the\s+)?(?:analytics|metrics|numbers|stats)\b/i;

const OAUTH_LEAKAGE = /\boauth\b|\bauthorize\s+(?:the\s+)?(?:youtube|channel|google|analytics|api|account)\b|\b(?:access|refresh)\s+token\b|\bclient\s+secret\b/i;
const PUBLISH_EXECUTION = /\bpush\s+(?:the\s+)?video\s+live\b|\bgo\s+live\s+now\b|\bre-?publish(?:es|ed|ing)?\b|\bre-?upload(?:s|ed|ing)?\b|\bupload\s+(?:it|the\s+video)\s+(?:again|now)\b/i;
const EXTERNAL_SCHEDULING = /\bschedule[sd]?\b[^.]{0,30}\b(?:via|through|using)\b[^.]{0,20}\b(?:api|provider|youtube)\b|\bschedule[sd]?\s+(?:the\s+)?(?:upload|publish|re-?upload|video)\s+(?:via|through|on\s+youtube|with\s+the\s+api)\b/i;
const RENDER_WORKER_LEAKAGE = /\brender\s+(?:worker|job|queue|farm)\b|\bqueue[sd]?\s+(?:a\s+)?render\b|\bremotion\b|\benqueue\s+(?:the\s+)?render\b|\bre-?render\s+the\s+(?:video|master|final\s+cut)\b/i;
const ASSET_GENERATION_LEAKAGE = /\b(?:generate|generates|render|renders|synthesize|synthesizes|produce|produces)\b[^.]{0,40}\b(?:image|images|voiceover\s+audio|voice\s+track|audio\s+file|video\s+file|footage|clip\s+file|b-?roll\s+footage|thumbnail\s+image)\b|\btext-to-(?:speech|image|video)\b/i;
const RECUT_GENERATION = /\b(?:generate|generates|produce|produces|create|creates|render|renders|cut|cuts|edit|edits)\b[^.]{0,30}\b(?:recut|re-cut|reels?|tiktok|vertical\s+(?:cut|version|edit)|youtube\s+shorts?|cross-?platform\s+(?:cut|recut|version|edit))\b|\bcross-?platform\s+recut\b/i;

/** Any attempt to change the approved, immutable release record. */
const RELEASE_RECORD_MUTATION = /\b(?:change|edit|update|rewrite|swap|replace|revise|re-?title|re-?work)\b[^.]{0,40}\b(?:the\s+)?(?:approved\s+)?(?:release\s+record|final\s+title|selected\s+title|selected\s+thumbnail|reconciled\s+metadata|published\s+(?:title|metadata|video))\b/i;

const VAGUE_PROMISE = /\beverything\s+(?:you\s+need\s+to\s+know|about\s+\w+)\b|\ball\s+you\s+need\s+to\s+know\b|\bthe\s+ultimate\s+guide\b|\bcomplete\s+guide\s+to\s+everything\b|\blearn\s+it\s+all\b|\banything\s+and\s+everything\b/i;

function allText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(allText);
  if (value && typeof value === "object") return Object.values(value).flatMap(allText);
  return [];
}

function viewerValueEvidence(result: ChannelVideoPerformanceResult) {
  const contract = result.viewerValue.contract;
  return [
    ...contract.viewerNeed.evidenceIds,
    ...contract.valuePromise.specificity.evidenceIds,
    ...contract.originalContribution.assessment.evidenceIds,
    ...contract.differentiation.evidenceIds,
    ...contract.evidenceSupport.evidenceIds,
    ...contract.actionability.evidenceIds,
    ...contract.trustworthiness.evidenceIds,
    ...contract.sustainability.evidenceIds,
    ...result.viewerValue.integrityFindings.flatMap((item) => item.evidenceIds),
  ];
}

/** The exact upstream strategy identity every KPI/hypothesis outcome and the strategy signal must anchor to. */
function transitiveStrategyRunId(upstream: ApprovedVideoReleaseArtifact) {
  return upstream.reference.upstreamVideoPackaging.upstreamVideoScript.upstreamVideoBrief.upstreamContentIntelligence.upstreamStrategy.strategyRunId;
}

const CLOSE = 1e-6;
const near = (left: number, right: number) => Math.abs(left - right) <= CLOSE + Math.abs(right) * 1e-4;

const COVERAGE_RANK: Record<"RICH" | "PARTIAL" | "SPARSE", number> = { SPARSE: 0, PARTIAL: 1, RICH: 2 };

/** Which snapshot value a release KPI is measured against, and the observed-metric enum + unit it must be reported under. */
function metricProbe(metric: ReleasedVideoKpiBindingIdentity["metric"], snapshot: OperatorPerformanceSnapshot): {
  observed: KpiHypothesisOutcome["metricObserved"];
  unit: KpiHypothesisOutcome["observedUnit"];
  value: number | null;
} {
  const m = snapshot.metrics;
  switch (metric) {
    case "IMPRESSIONS": return { observed: "IMPRESSIONS", unit: "COUNT", value: m.impressions };
    case "CLICK_THROUGH_RATE": return { observed: "CLICK_THROUGH_RATE", unit: "PERCENT", value: m.clickThroughRatePct };
    case "AVERAGE_VIEW_DURATION": return { observed: "AVERAGE_VIEW_DURATION", unit: "SECONDS", value: m.averageViewDurationSeconds };
    case "AUDIENCE_RETENTION": return { observed: "AUDIENCE_RETENTION", unit: "PERCENT", value: m.averagePercentageViewedPct };
    case "RETURNING_VIEWERS": return { observed: "RETURNING_VIEWERS", unit: "PERCENT", value: m.returningViewersPct };
    case "SUBSCRIBERS":
      return { observed: "NET_SUBSCRIBERS", unit: "COUNT", value: m.subscribersGained === null ? null : m.subscribersGained - (m.subscribersLost ?? 0) };
    case "REVENUE_INDICATOR": return { observed: "REVENUE_INDICATOR", unit: "USD", value: m.estimatedRevenueUsdIndicator };
    // Channel-level or funnel-level KPIs a per-video snapshot cannot answer.
    case "PUBLISHING_CONSISTENCY":
    case "CONVERSION_INDICATOR":
    case "OTHER":
    default:
      return { observed: "NONE", unit: "NONE", value: null };
  }
}

function bindingIdentityEquals(left: ReleasedVideoKpiBindingIdentity, right: ReleasedVideoKpiBindingIdentity) {
  return left.metric === right.metric && left.label === right.label && left.hypothesis === right.hypothesis && left.strategyRunId === right.strategyRunId;
}

/** Core metrics used to grade snapshot coverage. */
function coreMetricCount(snapshot: OperatorPerformanceSnapshot) {
  const m = snapshot.metrics;
  return [m.impressions, m.views, m.clickThroughRatePct, m.averageViewDurationSeconds, m.averagePercentageViewedPct, m.subscribersGained, m.estimatedRevenueUsdIndicator]
    .filter((value) => value !== null).length;
}

/**
 * The deterministic half of CHANNEL_VIDEO_PERFORMANCE QA, and the authoritative
 * one. Every rule here is mechanically checkable; judgement calls (is this a fair
 * reading of the numbers, is the confidence honest) belong to semantic QA, which
 * cannot clear anything decided here. `expectedSnapshot` is the exact operator
 * snapshot from the start request; the result must echo it verbatim.
 */
export function deterministicVideoPerformanceValidation(
  resultValue: unknown,
  upstream: ApprovedVideoReleaseArtifact,
  expectedSnapshot: unknown,
  maxPayloadBytes: number,
): Finding[] {
  const result = channelVideoPerformanceResultSchema.parse(resultValue);
  const snapshot = operatorPerformanceSnapshotSchema.parse(expectedSnapshot);
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], code: string, message: string, evidenceIds: string[] = []) => findings.push({ severity, code, message, evidenceIds });

  // --- Upstream identity and provenance -----------------------------------
  if (!canonicalEquals(result.upstreamVideoRelease, upstream.reference)) {
    add("error", "UPSTREAM_RELEASE_REFERENCE_CHANGED", "The measurement changed the exact approved video-release reference.");
  }
  if (!canonicalEquals(result.performanceScope, upstream.scope)) {
    add("error", "PERFORMANCE_SCOPE_IDENTITY_CHANGED", "The measurement altered the resolved topic, pillar, promise, final title, strategy identity, bound KPI set, or inherited viewer-value provenance.");
  }
  if (!canonicalEquals(result.performanceScope.inheritedViewerValueProvenance, upstream.scope.inheritedViewerValueProvenance)) {
    add("error", "VIEWER_VALUE_PROVENANCE_ALTERED", "The inherited Viewer Value provenance or contract hash was altered.");
  }
  if (result.source.releaseTopicId !== upstream.scope.releaseTopicId) {
    add("error", "SOURCE_TOPIC_MISMATCH", `The record cites topic ${result.source.releaseTopicId} but the resolved topic is ${upstream.scope.releaseTopicId}.`);
  }
  if (result.source.pillarId !== upstream.scope.pillarId) {
    add("error", "SOURCE_PILLAR_MISMATCH", `The record cites pillar ${result.source.pillarId} but the resolved topic belongs to ${upstream.scope.pillarId}.`);
  }
  if (result.source.finalTitle !== upstream.scope.finalTitle) {
    add("error", "SOURCE_TITLE_MISMATCH", "The record's final title does not match the approved release's final title verbatim.");
  }
  if (result.source.releasePromise !== upstream.scope.releasePromise) {
    add("error", "RELEASE_PROMISE_DIVERGES", "The record's release promise does not match the approved release's promise verbatim.");
  }

  // --- Operator snapshot echoed verbatim --------------------------------
  if (!canonicalEquals(result.measuredSnapshot, snapshot)) {
    add("error", "SNAPSHOT_ECHO_ALTERED", "The measured snapshot in the record does not match the operator-supplied snapshot verbatim.");
  }

  // --- Snapshot internal consistency -----------------------------------
  const m = result.measuredSnapshot.metrics;
  const consistencyBroken: string[] = [];
  if (m.views !== null && m.impressions !== null && m.views > m.impressions) {
    consistencyBroken.push("views exceed impressions");
    add("error", "SNAPSHOT_VIEWS_EXCEED_IMPRESSIONS", "The snapshot reports more views than impressions.");
  }
  if (m.averageViewDurationSeconds !== null && m.averageViewDurationSeconds > result.measuredSnapshot.videoDurationSeconds) {
    consistencyBroken.push("average view duration exceeds video length");
    add("error", "SNAPSHOT_AVD_EXCEEDS_DURATION", "The snapshot's average view duration is longer than the video.");
  }
  if (Date.parse(result.measuredSnapshot.observationWindow.start) > Date.parse(result.measuredSnapshot.observationWindow.end)) {
    consistencyBroken.push("observation window ends before it begins");
    add("error", "SNAPSHOT_WINDOW_INVERTED", "The observation window ends before it begins.");
  }
  if (m.averageViewDurationSeconds !== null && m.averagePercentageViewedPct !== null) {
    const impliedPct = (m.averageViewDurationSeconds / result.measuredSnapshot.videoDurationSeconds) * 100;
    if (Math.abs(impliedPct - m.averagePercentageViewedPct) > 20) {
      consistencyBroken.push("average view duration and average percentage viewed disagree by more than 20 points");
      add("error", "SNAPSHOT_RETENTION_INCONSISTENT", "The snapshot's average view duration and average percentage viewed are not consistent with the video length.");
    }
  }
  if (result.snapshotIntegrity.internallyConsistent && consistencyBroken.length > 0) {
    add("error", "SNAPSHOT_INTEGRITY_UNDERSTATED", `The record marks the snapshot internally consistent, but deterministic checks disagree: ${consistencyBroken.join("; ")}.`);
  }
  const computedCoverage = coreMetricCount(result.measuredSnapshot) >= 6 ? "RICH" : coreMetricCount(result.measuredSnapshot) >= 3 ? "PARTIAL" : "SPARSE";
  if (COVERAGE_RANK[result.snapshotIntegrity.coverage] > COVERAGE_RANK[computedCoverage]) {
    add("error", "SNAPSHOT_COVERAGE_OVERSTATED", `The record declares ${result.snapshotIntegrity.coverage} coverage but only ${coreMetricCount(result.measuredSnapshot)} core metrics are present (${computedCoverage}).`);
  }

  // --- KPI/hypothesis adjudication: exactly the release's bound set -------
  const boundList = upstream.scope.kpiBindings;
  const adjudicatedCounts = new Map<number, number>();
  for (const outcome of result.kpiHypothesisOutcomes) {
    const index = boundList.findIndex((binding) => bindingIdentityEquals(binding, outcome.binding));
    if (index < 0) {
      add("error", "HYPOTHESIS_NOT_FROM_RELEASE", `An outcome adjudicates a hypothesis (${outcome.binding.metric} / ${outcome.binding.label}) that is not one the approved release bound.`);
      continue;
    }
    adjudicatedCounts.set(index, (adjudicatedCounts.get(index) ?? 0) + 1);

    const probe = metricProbe(outcome.binding.metric, result.measuredSnapshot);
    const hasData = probe.value !== null;

    if (!hasData) {
      if (outcome.verdict !== "NOT_ENOUGH_DATA") {
        add("error", "HYPOTHESIS_OVERSTATED_WITHOUT_DATA", `The snapshot carries no ${outcome.binding.metric} value, so ${outcome.binding.label} must be NOT_ENOUGH_DATA, not ${outcome.verdict}.`);
      }
      if (outcome.metricObserved !== "NONE" || outcome.observedValue !== null || outcome.observedUnit !== "NONE") {
        add("error", "OBSERVED_VALUE_NOT_FROM_SNAPSHOT", `${outcome.binding.label} reports an observed metric the snapshot does not contain.`);
      }
    } else {
      if (outcome.metricObserved !== probe.observed || outcome.observedUnit !== probe.unit || outcome.observedValue === null || !near(outcome.observedValue, probe.value as number)) {
        add("error", "OBSERVED_VALUE_NOT_FROM_SNAPSHOT", `${outcome.binding.label} does not report the snapshot's ${probe.observed} value (${probe.value}) verbatim.`);
      }
    }

    // Comparison basis and the verdict it can carry.
    if (outcome.comparisonBasis === "UPSTREAM_STRATEGY_TARGET") {
      // The current strategy schema carries no numeric KPI target, so nothing can
      // substantiate this basis yet. Reject it rather than let a verdict rest on
      // a target that does not exist.
      add("error", "STRATEGY_TARGET_NOT_AVAILABLE", `${outcome.binding.label} compares against an upstream strategy target, but the strategy carries no numeric KPI target.`);
    } else if (outcome.comparisonBasis === "NO_BASELINE_QUALITATIVE") {
      if (outcome.baselineValue !== null) {
        add("error", "BASELINE_VALUE_WITHOUT_BASIS", `${outcome.binding.label} has a qualitative comparison basis but still records a baseline value.`);
      }
      if (outcome.verdict === "SUPPORTED" || outcome.verdict === "REFUTED") {
        add("error", "QUALITATIVE_VERDICT_OVERSTATED", `${outcome.binding.label} is ${outcome.verdict} with no baseline; a qualitative basis can only be INCONCLUSIVE or NOT_ENOUGH_DATA.`);
      }
    } else {
      // OPERATOR_SUPPLIED_BASELINE
      const baseline = result.measuredSnapshot.operatorBaselines.find((entry) => entry.metric === outcome.binding.metric);
      if (!baseline) {
        add("error", "BASELINE_NOT_OPERATOR_SUPPLIED", `${outcome.binding.label} cites an operator-supplied baseline, but the snapshot has no operator baseline for ${outcome.binding.metric}.`);
      } else if (outcome.baselineValue === null || !near(outcome.baselineValue, baseline.value)) {
        add("error", "BASELINE_NOT_OPERATOR_SUPPLIED", `${outcome.binding.label} does not cite the operator baseline value (${baseline.value}) verbatim.`);
      }
    }

    if ((outcome.verdict === "SUPPORTED" || outcome.verdict === "REFUTED")
      && (outcome.comparisonBasis !== "OPERATOR_SUPPLIED_BASELINE" || outcome.baselineValue === null || outcome.observedValue === null)) {
      add("error", "VERDICT_WITHOUT_BASELINE", `${outcome.binding.label} is ${outcome.verdict} without an operator baseline and observed value to compare.`);
    }

    if (outcome.binding.strategyRunId !== transitiveStrategyRunId(upstream)) {
      add("error", "KPI_STRATEGY_IDENTITY_MISMATCH", `${outcome.binding.label} cites strategy run ${outcome.binding.strategyRunId}, not the record's upstream strategy ${transitiveStrategyRunId(upstream)}.`);
    }
  }
  for (let index = 0; index < boundList.length; index += 1) {
    const count = adjudicatedCounts.get(index) ?? 0;
    if (count === 0) add("error", "HYPOTHESIS_COVERAGE_INCOMPLETE", `The release bound "${boundList[index].label}" but no outcome adjudicates it.`);
    else if (count > 1) add("error", "HYPOTHESIS_ADJUDICATED_TWICE", `"${boundList[index].label}" is adjudicated ${count} times; each bound hypothesis is adjudicated exactly once.`);
  }

  // --- Strategy signal anchors to the exact strategy identity -------------
  if (result.strategyRevisitSignal.strategyRunId !== transitiveStrategyRunId(upstream)) {
    add("error", "KPI_STRATEGY_IDENTITY_MISMATCH", `The strategy-revisit signal cites strategy run ${result.strategyRevisitSignal.strategyRunId}, not the record's upstream strategy ${transitiveStrategyRunId(upstream)}.`);
  }

  // --- Vague promise ----------------------------------------------------
  if (VAGUE_PROMISE.test(result.source.releasePromise)) {
    add("error", "RELEASE_PROMISE_VAGUE", "The release promise is too vague to verify the measured result against.");
  }

  // --- Evidence integrity --------------------------------------------------
  const known = new Map(upstream.discoveryBundle.evidence.map((item) => [item.id, item]));
  const cited = new Set<string>(viewerValueEvidence(result));
  const missing = [...cited].filter((id) => !known.has(id));
  if (missing.length) add("error", "EVIDENCE_REFERENCE_NOT_FOUND", "The record cites evidence IDs outside the approved upstream discovery bundle.", missing.slice(0, 20));

  for (const item of upstream.discoveryBundle.evidence) {
    const consistent = item.sourceType === "search"
      ? item.id === `yt:search:${item.sourceId}` && item.url === null
      : hasConsistentEvidenceIdentity({ id: item.id, url: item.url ?? "", sourceType: item.sourceType, sourceId: item.sourceId });
    if (!consistent) add("error", "EVIDENCE_IDENTITY_MISMATCH", `Upstream evidence identity is inconsistent for ${item.id}.`, [item.id]);
  }

  // --- Viewer Value Gate: deterministic floor overrules an optimistic model -
  const deterministic = deterministicViewerValueGate(result.viewerValue);
  const resolved = resolveViewerValueGate(deterministic.gate, result.viewerValue.gate);
  if (resolved !== result.viewerValue.gate) {
    add("error", "VIEWER_VALUE_GATE_UNDERSTATED", `The record claims gate ${result.viewerValue.gate} but deterministic rules require ${resolved}: ${deterministic.reasons.join(" ")}`);
  }
  if (resolved === "REJECT") add("error", "VIEWER_VALUE_GATE_REJECTED", `The record fails the Viewer Value Gate: ${deterministic.reasons.join(" ")}`);
  else if (resolved === "REVISE") add("error", "VIEWER_VALUE_GATE_REVISION_REQUIRED", `The record needs a stronger viewer-value case before it can finalize: ${deterministic.reasons.join(" ")}`);
  if (result.viewerValue.integrityFindings.some((item) => item.severity === "blocking")) {
    add("error", "CONTENT_INTEGRITY_BLOCKING_RISK", "The record depends on a blocking content-integrity risk.");
  }

  // --- Fabrication, ingestion, and downstream scope ----------------------
  if (result.measurementIntegrity.fabricationGuardOutcome !== "PASS") {
    add("error", "FABRICATION_GUARD_FAILED", "The record's re-run of the fabrication / no-ingestion guard did not pass; it cannot be finalized.");
  }
  const text = allText({
    ...result,
    // The verbatim operator snapshot is the record's own evidence, not a claim it
    // authored; excluding it keeps the operator's own numbers from tripping the
    // fabrication guards.
    measuredSnapshot: undefined,
  }).join("\n");
  if (FABRICATED_REVENUE.test(text)) add("error", "FABRICATED_REVENUE_PREDICTION", "The record asserts a projected revenue, CPM, or RPM figure.");
  if (FABRICATED_SEARCH_VOLUME.test(text)) add("error", "FABRICATED_SEARCH_VOLUME", "The record asserts search-volume data no configured provider supplies.");
  if (MONETARY_GUARANTEE.test(text)) add("error", "UNSUPPORTED_MONETARY_GUARANTEE", "The record contains an unsupported monetary guarantee.");
  if (FABRICATED_BENCHMARK.test(text)) add("error", "FABRICATED_BENCHMARK", "The record cites an industry average or category benchmark the operator did not supply.");
  if (FORWARD_PREDICTION.test(text)) add("error", "FORWARD_PREDICTION_SCOPE_VIOLATION", "The record predicts the performance of a future video; measurement interprets what already happened.");
  if (ANALYTICS_INGESTION.test(text)) add("error", "ANALYTICS_INGESTION_SCOPE_VIOLATION", "The record referenced ingesting or calling an analytics API; this stage interprets an operator-supplied snapshot only.");
  if (OAUTH_LEAKAGE.test(text)) add("error", "OAUTH_SCOPE_VIOLATION", "The record referenced provider OAuth or credential authorization, which this stage never performs.");
  if (PUBLISH_EXECUTION.test(text)) add("error", "PUBLISH_EXECUTION_SCOPE_VIOLATION", "The record attempted to re-publish or re-upload the video; measurement records learning only.");
  if (EXTERNAL_SCHEDULING.test(text)) add("error", "EXTERNAL_SCHEDULING_SCOPE_VIOLATION", "The record attempted to schedule through a provider API.");
  if (RENDER_WORKER_LEAKAGE.test(text)) add("error", "RENDER_WORKER_SCOPE_VIOLATION", "The record referenced a render worker or rendering job, which belongs to a production stage.");
  if (ASSET_GENERATION_LEAKAGE.test(text)) add("error", "ASSET_GENERATION_SCOPE_VIOLATION", "The record attempted to generate media assets, which belong to a production stage.");
  if (RECUT_GENERATION.test(text)) add("error", "RECUT_GENERATION_SCOPE_VIOLATION", "The record attempted to generate a cross-platform recut.");
  if (RELEASE_RECORD_MUTATION.test(text)) add("error", "RELEASE_RECORD_MUTATION_SCOPE_VIOLATION", "The record attempted to change the approved release record; it is immutable, and any change is a recommendation only.");

  const payloadBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (payloadBytes > maxPayloadBytes) {
    add("error", "RESULT_PAYLOAD_TOO_LARGE", `The record serializes to ${payloadBytes} bytes, above the ${maxPayloadBytes}-byte durable-output margin.`);
  }
  return findings;
}

const SEVERITY_RANK: Record<Finding["severity"], number> = { error: 0, warning: 1, info: 2 };

/**
 * Merges deterministic, semantic-QA, and independent-critic findings into one QA
 * verdict. `criticFindings` are decision-critical: they enter the pass/fail
 * evaluation in FULL and are never truncated before it, so a blocking critic
 * error always survives regardless of how many semantic-QA findings exist. Only
 * the persisted `findings` array is capped for storage/display — and errors are
 * ranked first so the cap can never drop a blocking finding.
 */
export function mergeVideoPerformanceQA(
  deterministic: Finding[],
  semantic: VideoPerformanceSemanticQAOutput,
  modelUsage: ModelUsage,
  upstream: ApprovedVideoReleaseArtifact,
  criticFindings: Finding[] = [],
): VideoPerformanceQAResult {
  const { findings, errors, score, recommendation } = mergeSemanticQAFindings(
    deterministic,
    { ...semantic, findings: [...semantic.findings, ...criticFindings] },
    new Set(upstream.discoveryBundle.evidence.map((item) => item.id)),
    "The video performance QA model cited an unknown evidence ID.",
  );
  const failingRules = new Set(deterministic.map((item) => item.code)).size;
  const ranked = [...findings].sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]);
  return videoPerformanceQAResultSchema.parse({
    passed: errors === 0 && score >= 75,
    score,
    findings: ranked.slice(0, 50),
    recommendation,
    deterministicChecksPassed: Math.max(0, DETERMINISTIC_VIDEO_PERFORMANCE_RULE_COUNT - failingRules),
    deterministicChecksFailed: failingRules,
    modelUsage,
  });
}

/**
 * Integrity failures are not cosmetically fixable: a record whose provenance is
 * corrupted, which alters the operator snapshot, which adjudicates a hypothesis
 * the release did not bind, which calls a hypothesis SUPPORTED without a
 * baseline, which fabricates a benchmark or prediction, or which tries to ingest
 * data or mutate the release must fail closed rather than be rewritten into
 * apparent compliance. Weak viewer value or an overstated confidence, by
 * contrast, is exactly what one bounded revision is for.
 */
export const UNREVISABLE_VIDEO_PERFORMANCE_CODES = new Set([
  "UPSTREAM_RELEASE_REFERENCE_CHANGED",
  "PERFORMANCE_SCOPE_IDENTITY_CHANGED",
  "VIEWER_VALUE_PROVENANCE_ALTERED",
  "VIEWER_VALUE_GATE_REJECTED",
  "CONTENT_INTEGRITY_BLOCKING_RISK",
  "KPI_STRATEGY_IDENTITY_MISMATCH",
  "SNAPSHOT_ECHO_ALTERED",
  "HYPOTHESIS_NOT_FROM_RELEASE",
  "HYPOTHESIS_OVERSTATED_WITHOUT_DATA",
  "VERDICT_WITHOUT_BASELINE",
  "QUALITATIVE_VERDICT_OVERSTATED",
  "BASELINE_NOT_OPERATOR_SUPPLIED",
  "FABRICATED_BENCHMARK",
  "FABRICATED_SEARCH_VOLUME",
  "FABRICATED_REVENUE_PREDICTION",
  "UNSUPPORTED_MONETARY_GUARANTEE",
  "FORWARD_PREDICTION_SCOPE_VIOLATION",
  "ANALYTICS_INGESTION_SCOPE_VIOLATION",
  "RELEASE_RECORD_MUTATION_SCOPE_VIOLATION",
  "EVIDENCE_REFERENCE_NOT_FOUND",
]);

export function hasUnrevisableVideoPerformanceFailure(findings: Finding[]) {
  return findings.some((finding) => finding.severity === "error" && UNREVISABLE_VIDEO_PERFORMANCE_CODES.has(finding.code));
}

/**
 * Includes the message because code plus evidence IDs alone could not tell apart
 * the same rule violated in two different places with no citations, letting a
 * revision reintroduce a violation and have it look pre-existing.
 */
export function videoPerformanceFindingFingerprint(finding: Finding) {
  return `${finding.code}:${[...finding.evidenceIds].sort().join(",")}:${finding.message}`;
}

export function newlyIntroducedVideoPerformanceErrors(before: Finding[], after: Finding[]) {
  const existing = new Set(before.filter((finding) => finding.severity === "error").map(videoPerformanceFindingFingerprint));
  return after.filter((finding) => finding.severity === "error" && !existing.has(videoPerformanceFindingFingerprint(finding)));
}
