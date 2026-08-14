import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "../src/server/media/storage";
import { inspectMedia } from "../src/server/rendering/media-inspection";
import { renderVideo } from "../src/server/rendering/render-video";
import { createSineWaveWav } from "../src/server/rendering/test-signal";
import { deterministicSampleInput, renderInputSchema } from "../src/video/schemas/render-input";

const root = path.resolve(process.cwd(), "renders", "verification"); const publicDirectory = path.join(root, "audio-public");
await mkdir(publicDirectory, { recursive: true });
const tone = createSineWaveWav({ durationSeconds: 4.8, amplitude: 0.32 }); await writeFile(path.join(publicDirectory, "licensed-test-tone.wav"), tone);
const input = renderInputSchema.parse({ ...deterministicSampleInput, audioTracks: [{ assetVersionId: "c67fd2ae-1936-4a30-bab2-89e3054e0104", role: "NARRATION", reference: "public://licensed-test-tone.wav", checksumSha256: sha256(tone), mimeType: "audio/wav", sourceDurationSeconds: 4.8, startSeconds: 0, trimStartSeconds: 0, durationSeconds: 4.8, gainDb: -3, fadeInSeconds: 0.1, fadeOutSeconds: 0.1 }] });
const outputPath = path.join(root, "channelwright-audio-verification.mp4"); await renderVideo(input, outputPath, { publicDir: publicDirectory });
console.log(JSON.stringify(await inspectMedia(outputPath), null, 2));
