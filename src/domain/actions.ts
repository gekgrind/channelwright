import { z } from "zod";
import { channelPreferencesSchema, conceptModeSchema, platformTargetSchema } from "./contracts";

export const workflowActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("CREATE_CHANNEL"),
    mode: conceptModeSchema,
    preferences: channelPreferencesSchema,
    concept: z.string().trim().min(10).max(500).optional(),
  }),
  z.object({ type: z.literal("CONCEPT_DECISION"), channelId: z.string().uuid(), decision: z.enum(["OVERRIDE_AND_CONTINUE", "REQUEST_ALTERNATIVES"]), feedback: z.string().max(1000).optional() }),
  z.object({ type: z.literal("REVISE_CONCEPT"), channelId: z.string().uuid(), concept: z.string().trim().min(10).max(500), niche: z.string().trim().min(2).max(160).optional(), feedback: z.string().max(1000).optional() }),
  z.object({ type: z.literal("SELECT_CONCEPT"), channelId: z.string().uuid(), candidateId: z.string().uuid() }),
  z.object({ type: z.literal("CREATE_VIDEO"), channelId: z.string().uuid(), topic: z.string().trim().min(5).max(300) }),
  z.object({ type: z.literal("SCRIPT_DECISION"), videoId: z.string().uuid(), decision: z.enum(["APPROVE", "REQUEST_CHANGES"]), feedback: z.string().max(2000).optional() }),
  z.object({
    type: z.literal("PLATFORM_ARTIFACT_DECISION"), videoId: z.string().uuid(), target: platformTargetSchema,
    artifactVersion: z.number().int().positive(), decision: z.enum(["APPROVE", "REQUEST_CHANGES"]),
    feedback: z.string().trim().max(2000).optional(),
  }),
]).superRefine((value, ctx) => {
  if (value.type === "CREATE_CHANNEL" && value.mode === "USER_DEFINED" && !value.concept) {
    ctx.addIssue({ code: "custom", path: ["concept"], message: "A concept is required in user-defined mode" });
  }
  if (value.type === "SCRIPT_DECISION" && value.decision === "REQUEST_CHANGES" && !value.feedback?.trim()) {
    ctx.addIssue({ code: "custom", path: ["feedback"], message: "Feedback is required when requesting changes" });
  }
  if (value.type === "PLATFORM_ARTIFACT_DECISION" && value.decision === "REQUEST_CHANGES" && !value.feedback?.trim()) {
    ctx.addIssue({ code: "custom", path: ["feedback"], message: "Feedback is required when requesting platform changes" });
  }
});

export type WorkflowAction = z.infer<typeof workflowActionSchema>;
