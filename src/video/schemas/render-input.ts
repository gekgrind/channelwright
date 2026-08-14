import { z } from "zod";

export const VIDEO_WIDTH = 1920;
export const VIDEO_HEIGHT = 1080;
export const VIDEO_FPS = 30;

const providerNeutralReferenceSchema = z.string().trim().min(1).max(2048).superRefine((reference, context) => {
  if (reference.includes("\0")) {
    context.addIssue({ code: "custom", message: "Media references cannot contain null bytes" });
  }

  if (/^(?:data|blob):/i.test(reference)) {
    context.addIssue({ code: "custom", message: "Media references must point to stored assets, not embedded binaries" });
  }

  try {
    const url = new URL(reference);
    if (url.username || url.password) {
      context.addIssue({ code: "custom", message: "Media references cannot contain credentials" });
    }
  } catch {
    // Opaque storage keys are valid provider-neutral references.
  }
});

export const renderAssetReferenceSchema = z.object({
  assetId: z.string().trim().min(1).max(160),
  kind: z.enum(["IMAGE", "VIDEO"]),
  reference: providerNeutralReferenceSchema,
});

export const renderSceneSchema = z.object({
  id: z.string().trim().min(1).max(120),
  role: z.enum(["TITLE", "CONTENT", "CTA"]),
  durationSeconds: z.number().positive().max(60 * 60),
  eyebrow: z.string().trim().max(120).optional(),
  headline: z.string().trim().min(1).max(180),
  body: z.string().trim().min(1).max(600),
  assetReferences: z.array(renderAssetReferenceSchema).max(12).default([]),
});

export const renderCaptionSchema = z.object({
  startSeconds: z.number().min(0),
  endSeconds: z.number().positive(),
  text: z.string().trim().min(1).max(240),
}).refine((caption) => caption.endSeconds > caption.startSeconds, {
  message: "Caption timing must end after it starts",
});

export const renderAudioTrackSchema = z.object({
  assetVersionId: z.string().uuid(),
  role: z.enum(["NARRATION", "MUSIC"]),
  reference: providerNeutralReferenceSchema,
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  mimeType: z.enum(["audio/wav", "audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg"]),
  sourceDurationSeconds: z.number().positive().max(24 * 60 * 60),
  startSeconds: z.number().min(0).max(24 * 60 * 60),
  trimStartSeconds: z.number().min(0).max(24 * 60 * 60).default(0),
  durationSeconds: z.number().positive().max(24 * 60 * 60),
  gainDb: z.number().min(-60).max(12).default(0),
  fadeInSeconds: z.number().min(0).max(60).default(0),
  fadeOutSeconds: z.number().min(0).max(60).default(0),
});

export const narrationDuckingSchema = z.object({
  enabled: z.boolean().default(true),
  amountDb: z.number().min(-36).max(0).default(-12),
  attackSeconds: z.number().min(0).max(5).default(0.15),
  releaseSeconds: z.number().min(0).max(5).default(0.35),
});

export const renderInputSchema = z.object({
  videoId: z.string().uuid(),
  approvedScriptVersion: z.number().int().positive(),
  title: z.string().trim().min(1).max(180),
  scenes: z.array(renderSceneSchema).min(3).max(200),
  narrationReference: providerNeutralReferenceSchema.nullable(),
  captions: z.array(renderCaptionSchema).max(10_000),
  musicReference: providerNeutralReferenceSchema.nullable().optional(),
  audioTracks: z.array(renderAudioTrackSchema).max(64).default([]),
  narrationDucking: narrationDuckingSchema.default({
    enabled: true,
    amountDb: -12,
    attackSeconds: 0.15,
    releaseSeconds: 0.35,
  }),
}).superRefine((input, context) => {
  const sceneIds = new Set<string>();
  const assetIds = new Set<string>();

  input.scenes.forEach((scene, sceneIndex) => {
    if (sceneIds.has(scene.id)) {
      context.addIssue({ code: "custom", path: ["scenes", sceneIndex, "id"], message: "Scene IDs must be unique" });
    }
    sceneIds.add(scene.id);

    scene.assetReferences.forEach((asset, assetIndex) => {
      if (assetIds.has(asset.assetId)) {
        context.addIssue({ code: "custom", path: ["scenes", sceneIndex, "assetReferences", assetIndex, "assetId"], message: "Asset IDs must be unique within a render" });
      }
      assetIds.add(asset.assetId);
    });
  });

  const durationSeconds = input.scenes.reduce((total, scene) => total + scene.durationSeconds, 0);
  input.captions.forEach((caption, captionIndex) => {
    if (caption.endSeconds > durationSeconds) {
      context.addIssue({ code: "custom", path: ["captions", captionIndex, "endSeconds"], message: "Caption timing cannot exceed the video duration" });
    }
  });

  for (const [trackIndex, track] of input.audioTracks.entries()) {
    if (track.trimStartSeconds + track.durationSeconds > track.sourceDurationSeconds + 0.001) {
      context.addIssue({ code: "custom", path: ["audioTracks", trackIndex, "durationSeconds"], message: "Audio trim and duration cannot exceed the inspected source duration" });
    }
    if (track.startSeconds + track.durationSeconds > durationSeconds + 0.001) {
      context.addIssue({ code: "custom", path: ["audioTracks", trackIndex, "durationSeconds"], message: "Audio timing cannot exceed the video duration" });
    }
    if (track.fadeInSeconds + track.fadeOutSeconds > track.durationSeconds) {
      context.addIssue({ code: "custom", path: ["audioTracks", trackIndex], message: "Audio fades cannot be longer than the track" });
    }
  }

  for (const role of ["NARRATION", "MUSIC"] as const) {
    const ordered = input.audioTracks
      .map((track, index) => ({ track, index }))
      .filter(({ track }) => track.role === role)
      .sort((left, right) => left.track.startSeconds - right.track.startSeconds);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (current.track.startSeconds < previous.track.startSeconds + previous.track.durationSeconds - 0.001) {
        context.addIssue({ code: "custom", path: ["audioTracks", current.index, "startSeconds"], message: `${role.toLowerCase()} tracks cannot overlap` });
      }
    }
  }
});

export type RenderInput = z.infer<typeof renderInputSchema>;
export type RenderScene = z.infer<typeof renderSceneSchema>;

export const secondsToFrames = (seconds: number) => Math.max(1, Math.round(seconds * VIDEO_FPS));

export const calculateDurationInFrames = (input: RenderInput) =>
  input.scenes.reduce((total, scene) => total + secondsToFrames(scene.durationSeconds), 0);

export const deterministicSampleInput: RenderInput = renderInputSchema.parse({
  videoId: "6f42a9af-70c6-4aa7-bcb2-cd674ab5b611",
  approvedScriptVersion: 1,
  title: "Ideas deserve a production system",
  scenes: [
    {
      id: "title-card",
      role: "TITLE",
      durationSeconds: 1.2,
      eyebrow: "CHANNELWRIGHT BY ENTREPRENEURIA",
      headline: "Ideas deserve a production system",
      body: "A deterministic local rendering proof — built without provider calls or downloaded assets.",
      assetReferences: [],
    },
    {
      id: "research-scene",
      role: "CONTENT",
      durationSeconds: 1.2,
      eyebrow: "01 · EVIDENCE",
      headline: "Research before production",
      body: "Keep claims, sources, unknowns, and creative decisions connected from the first brief.",
      assetReferences: [{ assetId: "research-visual", kind: "IMAGE", reference: "synthetic://research-grid" }],
    },
    {
      id: "workflow-scene",
      role: "CONTENT",
      durationSeconds: 1.2,
      eyebrow: "02 · CONTROL",
      headline: "Humans approve each version",
      body: "Scripts, render inputs, and future distribution assets remain versioned and reviewable.",
      assetReferences: [{ assetId: "workflow-visual", kind: "VIDEO", reference: "synthetic://workflow-pulse" }],
    },
    {
      id: "closing-cta",
      role: "CTA",
      durationSeconds: 1.2,
      eyebrow: "BUILD WITH INTENT",
      headline: "Turn the next idea into a system",
      body: "Channelwright keeps the work visible, deterministic, and human-directed.",
      assetReferences: [],
    },
  ],
  narrationReference: null,
  captions: [
    { startSeconds: 0.15, endSeconds: 1.1, text: "Ideas deserve a production system." },
    { startSeconds: 1.3, endSeconds: 2.3, text: "Research before production." },
    { startSeconds: 2.5, endSeconds: 3.5, text: "Humans approve each version." },
    { startSeconds: 3.7, endSeconds: 4.7, text: "Turn the next idea into a system." },
  ],
  musicReference: null,
});
