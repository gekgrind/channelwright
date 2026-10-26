/**
 * The narrow rows the lineage read-model works from. They are read with the
 * signed-in user's RLS-bound client only (load-lineage-rows.ts) and are never
 * written. `input` holds only the lineage-bearing keys of `input_payload`.
 */

export interface LineageWorkflowRow {
  id: string;
  workflowType: string;
  status: string;
  createdAt: string;
}

export interface LineageRunRow {
  id: string;
  workflowId: string;
  status: string;
  createdAt: string;
  /** The run this one revises, from `context_payload.previousRunId`; null for a first run. */
  previousRunId: string | null;
  input: Record<string, unknown>;
}

export interface LineageApprovalRow {
  id: string;
  workflowId: string;
  runId: string;
  status: string;
  requestedAt: string;
  decidedAt: string | null;
}

export interface LineageRows {
  workflows: LineageWorkflowRow[];
  runs: LineageRunRow[];
  approvals: LineageApprovalRow[];
}

/**
 * One linear production stage: where its request names the upstream run, which
 * persisted reference proves it, and the field prefix every approved reference
 * uses for that upstream stage (`<prefix>WorkflowId`, `<prefix>RunId`).
 */
export interface LinearStage {
  type: string;
  upstreamType: string;
  requestWorkflowKey: string;
  requestRunKey: string;
  referenceKey: string;
}

export const LINEAR_STAGES: readonly LinearStage[] = [
  { type: "CHANNEL_STRATEGY", upstreamType: "CHANNEL_RESEARCH", requestWorkflowKey: "researchWorkflowId", requestRunKey: "researchRunId", referenceKey: "approvedResearchReference" },
  { type: "CHANNEL_CONTENT_INTELLIGENCE", upstreamType: "CHANNEL_STRATEGY", requestWorkflowKey: "strategyWorkflowId", requestRunKey: "strategyRunId", referenceKey: "approvedStrategyReference" },
  { type: "CHANNEL_VIDEO_BRIEF", upstreamType: "CHANNEL_CONTENT_INTELLIGENCE", requestWorkflowKey: "contentIntelligenceWorkflowId", requestRunKey: "contentIntelligenceRunId", referenceKey: "approvedContentReference" },
  { type: "CHANNEL_VIDEO_SCRIPT", upstreamType: "CHANNEL_VIDEO_BRIEF", requestWorkflowKey: "videoBriefWorkflowId", requestRunKey: "videoBriefRunId", referenceKey: "approvedVideoBriefReference" },
  { type: "CHANNEL_VIDEO_PACKAGING", upstreamType: "CHANNEL_VIDEO_SCRIPT", requestWorkflowKey: "videoScriptWorkflowId", requestRunKey: "videoScriptRunId", referenceKey: "approvedVideoScriptReference" },
  { type: "CHANNEL_VIDEO_RELEASE", upstreamType: "CHANNEL_VIDEO_PACKAGING", requestWorkflowKey: "videoPackagingWorkflowId", requestRunKey: "videoPackagingRunId", referenceKey: "approvedVideoPackagingReference" },
  { type: "CHANNEL_VIDEO_PERFORMANCE", upstreamType: "CHANNEL_VIDEO_RELEASE", requestWorkflowKey: "videoReleaseWorkflowId", requestRunKey: "videoReleaseRunId", referenceKey: "approvedVideoReleaseReference" },
  { type: "CHANNEL_VIDEO_DIAGNOSIS", upstreamType: "CHANNEL_VIDEO_PERFORMANCE", requestWorkflowKey: "videoPerformanceWorkflowId", requestRunKey: "videoPerformanceRunId", referenceKey: "approvedVideoPerformanceReference" },
  { type: "CHANNEL_VIDEO_DECISION", upstreamType: "CHANNEL_VIDEO_DIAGNOSIS", requestWorkflowKey: "videoDiagnosisWorkflowId", requestRunKey: "videoDiagnosisRunId", referenceKey: "approvedVideoDiagnosisReference" },
  { type: "CHANNEL_VIDEO_EXPERIMENT", upstreamType: "CHANNEL_VIDEO_DECISION", requestWorkflowKey: "videoDecisionWorkflowId", requestRunKey: "videoDecisionRunId", referenceKey: "approvedVideoDecisionReference" },
];

/** Field prefix approved references use for each stage, and the key that nests its own upstream. */
export const REFERENCE_SHAPE: Record<string, { prefix: string; upstreamKey: string | null }> = {
  CHANNEL_RESEARCH: { prefix: "research", upstreamKey: null },
  CHANNEL_STRATEGY: { prefix: "strategy", upstreamKey: "upstreamResearch" },
  CHANNEL_CONTENT_INTELLIGENCE: { prefix: "content", upstreamKey: "upstreamStrategy" },
  CHANNEL_VIDEO_BRIEF: { prefix: "brief", upstreamKey: "upstreamContentIntelligence" },
  CHANNEL_VIDEO_SCRIPT: { prefix: "script", upstreamKey: "upstreamVideoBrief" },
  CHANNEL_VIDEO_PACKAGING: { prefix: "packaging", upstreamKey: "upstreamVideoScript" },
  CHANNEL_VIDEO_RELEASE: { prefix: "release", upstreamKey: "upstreamVideoPackaging" },
  CHANNEL_VIDEO_PERFORMANCE: { prefix: "performance", upstreamKey: "upstreamVideoRelease" },
  CHANNEL_VIDEO_DIAGNOSIS: { prefix: "diagnosis", upstreamKey: "upstreamVideoPerformance" },
  CHANNEL_VIDEO_DECISION: { prefix: "decision", upstreamKey: "upstreamVideoDiagnosis" },
  // Experiment references carry a flat decision summary instead of a nested chain.
  CHANNEL_VIDEO_EXPERIMENT: { prefix: "experiment", upstreamKey: null },
};

/** Keys of `input_payload` the loader projects: request ids (text) and references (json). */
export const INPUT_TEXT_KEYS = ["niche", "channelConcept", ...LINEAR_STAGES.flatMap((stage) => [stage.requestWorkflowKey, stage.requestRunKey])];
export const INPUT_JSON_KEYS = [
  ...LINEAR_STAGES.map((stage) => stage.referenceKey),
  "experimentSelections", "approvedVideoExperimentReferences",
  "portfolioSelections", "approvedVideoPortfolioReferences",
];
