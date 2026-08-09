import type { ChannelState, VideoState } from "./contracts";

export class IllegalTransitionError extends Error {
  constructor(entity: "channel" | "video", from: string, to: string) {
    super(`Illegal ${entity} transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

const channelTransitions: Record<ChannelState, readonly ChannelState[]> = {
  DRAFT: ["CONCEPT_RESEARCH_PENDING", "CONCEPT_DISCOVERY_PENDING"],
  CONCEPT_RESEARCH_PENDING: ["CONCEPT_REVIEW_REQUIRED", "CONCEPT_ACCEPTED", "FAILED"],
  CONCEPT_REVIEW_REQUIRED: ["CONCEPT_RESEARCH_PENDING", "CONCEPT_DISCOVERY_PENDING", "CONCEPT_ACCEPTED"],
  CONCEPT_DISCOVERY_PENDING: ["CONCEPT_SELECTION_REQUIRED", "FAILED"],
  CONCEPT_SELECTION_REQUIRED: ["CONCEPT_ACCEPTED", "CONCEPT_RESEARCH_PENDING"],
  CONCEPT_ACCEPTED: ["CHANNEL_STRATEGY_PENDING"],
  CHANNEL_STRATEGY_PENDING: ["READY_FOR_VIDEO_PRODUCTION", "FAILED"],
  READY_FOR_VIDEO_PRODUCTION: [],
  FAILED: ["CONCEPT_RESEARCH_PENDING", "CONCEPT_DISCOVERY_PENDING", "CHANNEL_STRATEGY_PENDING"],
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
