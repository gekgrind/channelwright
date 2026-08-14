import { z } from "zod";
import { channelPreferencesSchema, conceptModeSchema, platformTargetSchema } from "./contracts";
import { referenceChannelRequestSchema, referenceReportSectionSchema } from "./studio-contracts";
import { canonicalizeYouTubeChannelUrl } from "./youtube-channel-url";
import { offerTypeSchema } from "./strategy-contracts";
import { mediaProductionActionSchema, type MediaProductionAction } from "./media-production";

export const workflowActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CREATE_CHANNEL"),
    mode: conceptModeSchema,
    preferences: channelPreferencesSchema,
    concept: z.string().trim().min(10).max(500).optional(),
    referenceChannel: referenceChannelRequestSchema.optional(),
  }),
  z.object({ type: z.literal("CONCEPT_DECISION"), channelId: z.string().uuid(), decision: z.enum(["OVERRIDE_AND_CONTINUE", "REQUEST_ALTERNATIVES"]), feedback: z.string().max(1000).optional() }),
  z.object({ type: z.literal("REVISE_CONCEPT"), channelId: z.string().uuid(), concept: z.string().trim().min(10).max(500), niche: z.string().trim().min(2).max(160).optional(), feedback: z.string().max(1000).optional() }),
  z.object({ type: z.literal("SELECT_CONCEPT"), channelId: z.string().uuid(), candidateId: z.string().uuid() }),
  z.object({ type: z.literal("CREATE_VIDEO"), channelId: z.string().uuid(), topic: z.string().trim().min(5).max(300) }),
  z.object({ type: z.literal("SCRIPT_DECISION"), videoId: z.string().uuid(), decision: z.enum(["APPROVE", "REQUEST_CHANGES"]), feedback: z.string().max(2000).optional(), source: z.literal("CONVERSATION").optional() }),
  z.object({
    type: z.literal("PLATFORM_ARTIFACT_DECISION"), videoId: z.string().uuid(), target: platformTargetSchema,
    artifactVersion: z.number().int().positive(), decision: z.enum(["APPROVE", "REQUEST_CHANGES"]),
    feedback: z.string().trim().max(2000).optional(),
  }),
  z.object({
    type: z.literal("REVISE_REFERENCE_REPORT"), channelId: z.string().uuid(), reportVersion: z.number().int().positive(),
    section: referenceReportSectionSchema, instructions: z.string().trim().min(3).max(4000), source: z.literal("CONVERSATION").optional(),
  }),
  z.object({
    type: z.literal("REFERENCE_REPORT_DECISION"), channelId: z.string().uuid(), reportVersion: z.number().int().positive(),
    decision: z.enum(["APPROVE", "REJECT_DIRECTION", "SWITCH_TO_USER_DEFINED", "SWITCH_TO_DISCOVERY"]),
    feedback: z.string().trim().max(2000).optional(), concept: z.string().trim().min(10).max(500).optional(),
    niche: z.string().trim().min(2).max(160).optional(),
  }),
  z.object({ type: z.literal("RETRY_REFERENCE_RESEARCH"), channelId: z.string().uuid() }),
  z.object({
    type: z.literal("BUSINESS_STRATEGY_DECISION"), channelId: z.string().uuid(), strategyVersion: z.number().int().positive(),
    decision: z.enum(["APPROVE", "REQUEST_CHANGES"]), feedback: z.string().trim().max(4000).optional(), source: z.literal("CONVERSATION").optional(),
  }),
  z.object({
    type: z.literal("SELECT_STRATEGY_OFFER"), channelId: z.string().uuid(), strategyVersion: z.number().int().positive(),
    offerType: offerTypeSchema, candidateId: z.string().uuid(),
  }),
  z.object({ type: z.literal("CREATE_PILLAR_VIDEO"), channelId: z.string().uuid(), strategyVersion: z.number().int().positive() }),
  z.object({ type: z.literal("CREATE_RESOURCE_BUILD"), channelId: z.string().uuid(), strategyVersion: z.number().int().positive() }),
  z.object({ type: z.literal("CREATE_PRODUCT_BUILD"), channelId: z.string().uuid(), strategyVersion: z.number().int().positive() }),
  z.object({
    type: z.literal("BUILD_SPEC_DECISION"), buildProjectId: z.string().uuid(), specificationVersion: z.number().int().positive(),
    decision: z.enum(["APPROVE", "REQUEST_CHANGES"]), feedback: z.string().trim().max(4000).optional(), source: z.literal("CONVERSATION").optional(),
  }),
  z.object({
    type: z.literal("BUILD_ARTIFACT_DECISION"), buildProjectId: z.string().uuid(), artifactVersion: z.number().int().positive(),
    decision: z.enum(["APPROVE", "REQUEST_CHANGES", "RESTORE_AS_NEW_VERSION"]), feedback: z.string().trim().max(4000).optional(), source: z.literal("CONVERSATION").optional(),
  }),
  z.object({
    type: z.literal("CAPTURE_FIXTURE_SUBSCRIBER"), buildProjectId: z.string().uuid(), email: z.string().trim().email().max(320),
    consent: z.literal(true), source: z.string().trim().min(1).max(200),
  }),
  z.object({ type: z.literal("ACTIVATE_FIXTURE_PRODUCT"), buildProjectId: z.string().uuid(), artifactVersion: z.number().int().positive(), amountMinor: z.number().int().positive().max(10_000_000), currency: z.string().length(3).default("USD") }),
  z.object({ type: z.literal("CREATE_FIXTURE_CHECKOUT"), productId: z.string().uuid(), priceId: z.string().uuid(), customerReference: z.string().trim().min(3).max(320) }),
  z.object({ type: z.literal("PROCESS_FIXTURE_COMMERCE_EVENT"), checkoutId: z.string().min(10).max(200), providerEventId: z.string().min(5).max(200), eventType: z.enum(["PAYMENT_CONFIRMED", "PAYMENT_REFUNDED"]) }),
  z.object({ type: z.literal("GENERATE_MONETIZATION_PLAN"), channelId: z.string().uuid(), strategyVersion: z.number().int().positive() }),
  z.object({ type: z.literal("MONETIZATION_PLAN_DECISION"), channelId: z.string().uuid(), planVersion: z.number().int().positive(), decision: z.enum(["APPROVE", "REQUEST_CHANGES"]), feedback: z.string().trim().max(4000).optional(), source: z.literal("CONVERSATION").optional() }),
]).superRefine((value, ctx) => {
  if (value.type === "CREATE_CHANNEL" && value.mode === "USER_DEFINED" && !value.concept) {
    ctx.addIssue({ code: "custom", path: ["concept"], message: "A concept is required in user-defined mode" });
  }
  if (value.type === "CREATE_CHANNEL" && value.mode === "REFERENCE_CHANNEL" && !value.referenceChannel) {
    ctx.addIssue({ code: "custom", path: ["referenceChannel"], message: "A YouTube channel URL is required in reference-channel mode" });
  }
  if (value.type === "CREATE_CHANNEL" && value.mode === "REFERENCE_CHANNEL" && value.referenceChannel) {
    try { canonicalizeYouTubeChannelUrl(value.referenceChannel.url); }
    catch (error) { ctx.addIssue({ code: "custom", path: ["referenceChannel", "url"], message: error instanceof Error ? error.message : "Unsupported YouTube channel URL" }); }
  }
  if (value.type === "CREATE_CHANNEL" && value.mode !== "REFERENCE_CHANNEL" && value.referenceChannel) {
    ctx.addIssue({ code: "custom", path: ["referenceChannel"], message: "Reference-channel input is only valid in reference-channel mode" });
  }
  if (value.type === "SCRIPT_DECISION" && value.decision === "REQUEST_CHANGES" && !value.feedback?.trim()) {
    ctx.addIssue({ code: "custom", path: ["feedback"], message: "Feedback is required when requesting changes" });
  }
  if (value.type === "PLATFORM_ARTIFACT_DECISION" && value.decision === "REQUEST_CHANGES" && !value.feedback?.trim()) {
    ctx.addIssue({ code: "custom", path: ["feedback"], message: "Feedback is required when requesting platform changes" });
  }
  if (value.type === "REFERENCE_REPORT_DECISION" && value.decision === "SWITCH_TO_USER_DEFINED" && !value.concept) {
    ctx.addIssue({ code: "custom", path: ["concept"], message: "A concept is required when switching to user-defined mode" });
  }
  if (value.type === "BUSINESS_STRATEGY_DECISION" && value.decision === "REQUEST_CHANGES" && !value.feedback?.trim()) {
    ctx.addIssue({ code: "custom", path: ["feedback"], message: "Feedback is required when requesting strategy changes" });
  }
  if (value.type === "BUILD_SPEC_DECISION" && value.decision === "REQUEST_CHANGES" && !value.feedback?.trim()) {
    ctx.addIssue({ code: "custom", path: ["feedback"], message: "Feedback is required when requesting specification changes" });
  }
  if (value.type === "BUILD_ARTIFACT_DECISION" && value.decision === "REQUEST_CHANGES" && !value.feedback?.trim()) {
    ctx.addIssue({ code: "custom", path: ["feedback"], message: "Feedback is required when requesting artifact changes" });
  }
  if (value.type === "MONETIZATION_PLAN_DECISION" && value.decision === "REQUEST_CHANGES" && !value.feedback?.trim()) {
    ctx.addIssue({ code: "custom", path: ["feedback"], message: "Feedback is required when requesting monetization changes" });
  }
});

export type CoreWorkflowAction = z.infer<typeof workflowActionSchema>;
export type WorkflowAction = CoreWorkflowAction | MediaProductionAction;
export const workflowRequestSchema = z.union([workflowActionSchema, mediaProductionActionSchema]);
export type WorkflowRequest = WorkflowAction;
