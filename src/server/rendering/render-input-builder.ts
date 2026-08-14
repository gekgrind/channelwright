import type { Script } from "@/domain/contracts";
import type { MediaAssetVersionRecord } from "@/domain/media-production";
import { renderInputSchema } from "@/video/schemas/render-input";

export function buildRenderInput(input: { videoId: string; script: Script; assets: MediaAssetVersionRecord[] }) {
  const { videoId, script, assets } = input;
  const sceneSpecs = [
    { heading: script.title, narration: script.hook, duration: Math.min(12, Math.max(2, script.sections[0]?.estimatedSeconds ?? 4)), role: "TITLE" as const },
    ...script.sections.map((section) => ({ heading: section.heading, narration: section.narration, duration: section.estimatedSeconds, role: "CONTENT" as const })),
    { heading: "Next step", narration: script.cta || script.outro, duration: 5, role: "CTA" as const },
  ];
  const visualAssets = assets.filter((asset) => asset.kind === "IMAGE" || asset.kind === "VIDEO");
  let cursor = 0;
  const totalDuration = sceneSpecs.reduce((sum, scene) => sum + scene.duration, 0);
  const narrationAssets = assets.filter((asset) => asset.kind === "NARRATION");
  const musicAssets = assets.filter((asset) => asset.kind === "MUSIC");
  if (narrationAssets.length > 1 || musicAssets.length > 1) throw new Error("A render input currently supports at most one narration and one music asset version");

  const audioTracks = [
    ...narrationAssets.map((asset) => toAudioTrack(asset, "NARRATION" as const, totalDuration, -3)),
    ...musicAssets.map((asset) => toAudioTrack(asset, "MUSIC" as const, totalDuration, -18)),
  ];

  return renderInputSchema.parse({
    videoId,
    approvedScriptVersion: script.version,
    title: script.title,
    scenes: sceneSpecs.map((scene, index) => {
      const asset = visualAssets[index % Math.max(1, visualAssets.length)];
      return {
        id: `scene-${index + 1}`, role: scene.role, durationSeconds: scene.duration, headline: scene.heading, body: scene.narration,
        assetReferences: asset ? [{ assetId: asset.id, kind: asset.kind, reference: asset.storageKey }] : [],
      };
    }),
    narrationReference: null,
    musicReference: null,
    captions: sceneSpecs.map((scene) => {
      const cue = { startSeconds: cursor, endSeconds: cursor + scene.duration, text: scene.narration.slice(0, 240) };
      cursor += scene.duration;
      return cue;
    }),
    audioTracks,
  });
}

function toAudioTrack(asset: MediaAssetVersionRecord, role: "NARRATION" | "MUSIC", durationSeconds: number, gainDb: number) {
  if (!asset.durationSeconds || asset.durationSeconds + 0.001 < durationSeconds) throw new Error(`${role.toLowerCase()} asset ${asset.id} is shorter than the render and looping is not implicit`);
  return {
    assetVersionId: asset.id, role, reference: asset.storageKey, checksumSha256: asset.checksumSha256,
    mimeType: asset.mimeType, sourceDurationSeconds: asset.durationSeconds, startSeconds: 0, trimStartSeconds: 0,
    durationSeconds, gainDb, fadeInSeconds: role === "MUSIC" ? 0.5 : 0.05, fadeOutSeconds: role === "MUSIC" ? 1 : 0.05,
  };
}
