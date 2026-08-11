import type { ChannelState, VideoState } from "./contracts";
import type { BuildProjectState } from "./build-contracts";

export class IllegalTransitionError extends Error {
  constructor(entity: "channel" | "video" | "build", from: string, to: string) {
    super(`Illegal ${entity} transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

const channelTransitions: Record<ChannelState, readonly ChannelState[]> = {
  DRAFT: ["CONCEPT_RESEARCH_PENDING", "CONCEPT_DISCOVERY_PENDING", "REFERENCE_CHANNEL_RESEARCH_PENDING"],
  CONCEPT_RESEARCH_PENDING: ["CONCEPT_REVIEW_REQUIRED", "CONCEPT_ACCEPTED", "FAILED"],
  CONCEPT_REVIEW_REQUIRED: ["CONCEPT_RESEARCH_PENDING", "CONCEPT_DISCOVERY_PENDING", "CONCEPT_ACCEPTED"],
  CONCEPT_DISCOVERY_PENDING: ["CONCEPT_SELECTION_REQUIRED", "FAILED"],
  CONCEPT_SELECTION_REQUIRED: ["CONCEPT_ACCEPTED", "CONCEPT_RESEARCH_PENDING"],
  REFERENCE_CHANNEL_RESEARCH_PENDING: ["REFERENCE_CHANNEL_REVIEW_REQUIRED", "FAILED"],
  REFERENCE_CHANNEL_REVIEW_REQUIRED: ["REFERENCE_CHANNEL_RESEARCH_PENDING", "CONCEPT_DISCOVERY_PENDING", "CONCEPT_RESEARCH_PENDING", "CONCEPT_ACCEPTED"],
  CONCEPT_ACCEPTED: ["CHANNEL_STRATEGY_PENDING"],
  CHANNEL_STRATEGY_PENDING: ["BUSINESS_STRATEGY_REVIEW_REQUIRED", "FAILED"],
  BUSINESS_STRATEGY_REVIEW_REQUIRED: ["CHANNEL_STRATEGY_PENDING", "READY_FOR_VIDEO_PRODUCTION"],
  READY_FOR_VIDEO_PRODUCTION: [],
  FAILED: ["CONCEPT_RESEARCH_PENDING", "CONCEPT_DISCOVERY_PENDING", "REFERENCE_CHANNEL_RESEARCH_PENDING", "CHANNEL_STRATEGY_PENDING"],
};

const videoTransitions: Record<VideoState, readonly VideoState[]> = {
  DRAFT: ["STRATEGY_PENDING", "CANCELLED"],
  STRATEGY_PENDING: ["RESEARCH_PENDING", "FAILED"],
  RESEARCH_PENDING: ["SCRIPT_PENDING", "FAILED"],
  SCRIPT_PENDING: ["SCRIPT_QA_PENDING", "FAILED"],
  SCRIPT_QA_PENDING: ["SCRIPT_REVIEW_REQUIRED", "SCRIPT_PENDING", "FAILED"],
  SCRIPT_REVIEW_REQUIRED: ["SCRIPT_APPROVED", "SCRIPT_PENDING", "CANCELLED"],
  SCRIPT_APPROVED: [],
  FAILED: ["STRATEGY_PENDING", "RESEARCH_PENDING", "SCRIPT_PENDING", "SCRIPT_QA_PENDING"],
  CANCELLED: [],
};

export function transitionChannel(from: ChannelState, to: ChannelState): ChannelState {
  if (!channelTransitions[from].includes(to)) throw new IllegalTransitionError("channel", from, to);
  return to;
}

export function transitionVideo(from: VideoState, to: VideoState): VideoState {
  if (!videoTransitions[from].includes(to)) throw new IllegalTransitionError("video", from, to);
  return to;
}

export const canTransitionChannel = (from: ChannelState, to: ChannelState) => channelTransitions[from].includes(to);
export const canTransitionVideo = (from: VideoState, to: VideoState) => videoTransitions[from].includes(to);

const buildTransitions: Record<BuildProjectState, readonly BuildProjectState[]> = {
  DRAFT: ["SPEC_REVIEW"], SPEC_REVIEW: ["SPEC_REVIEW", "BUILDING"], BUILDING: ["QA"], QA: ["USER_REVIEW", "BUILDING"],
  USER_REVIEW: ["BUILDING", "APPROVED"], APPROVED: ["DEPLOYMENT_BLOCKED", "READY_TO_DEPLOY"],
  DEPLOYMENT_BLOCKED: ["READY_TO_DEPLOY"], READY_TO_DEPLOY: ["DEPLOYED", "DEPLOYMENT_BLOCKED"], DEPLOYED: [],
};

export function transitionBuild(from: BuildProjectState, to: BuildProjectState): BuildProjectState {
  if (!buildTransitions[from].includes(to)) throw new IllegalTransitionError("build", from, to);
  return to;
}
