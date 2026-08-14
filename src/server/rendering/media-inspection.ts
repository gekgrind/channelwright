import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { RenderInternals } from "@remotion/renderer";

interface ProbeStream { codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string; pix_fmt?: string; sample_rate?: string; channels?: number }
interface ProbeResult { streams?: ProbeStream[]; format?: { format_name?: string; duration?: string; size?: string } }

const fraction = (value?: string) => {
  if (!value) return null;
  const parts = value.split("/");
  const numerator = Number(parts[0]); const denominator = Number(parts[1] ?? "1");
  return denominator !== 0 && Number.isFinite(numerator / denominator) ? numerator / denominator : null;
};

const checksumFile = async (file: string) => new Promise<string>((resolve, reject) => {
  const hash = createHash("sha256"); const stream = createReadStream(file);
  stream.on("data", (chunk) => hash.update(chunk)); stream.on("error", reject); stream.on("end", () => resolve(hash.digest("hex")));
});

const callFf = async (bin: "ffmpeg" | "ffprobe", args: string[]) => {
  const process = RenderInternals.callFf({ args, bin, indent: false, logLevel: "error", binariesDirectory: null, cancelSignal: undefined, options: { reject: false } });
  const result = await process;
  if (result.exitCode !== 0) throw new Error(`${bin} inspection failed with exit code ${result.exitCode}: ${String(result.stderr).slice(-1000)}`);
  return { stdout: result.stdout, stderr: result.stderr };
};

export interface TechnicalMediaInspection {
  checksumSha256: string; container: string; videoCodec: string | null; audioCodec: string | null;
  videoStreamCount: number; audioStreamCount: number; width: number | null; height: number | null;
  frameRate: number | null; pixelFormat: string | null; durationSeconds: number; fileSize: number;
  audioSampleRate: number | null; audioChannels: number | null; integratedLoudnessLufs: number | null;
  truePeakDbfs: number | null; maxVolumeDbfs: number | null; silenceRatio: number | null;
}

export async function inspectMedia(file: string): Promise<TechnicalMediaInspection> {
  const probeOutput = await callFf("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file]);
  const probe = JSON.parse(probeOutput.stdout) as ProbeResult;
  const streams = probe.streams ?? []; const videoStreams = streams.filter((stream) => stream.codec_type === "video"); const audioStreams = streams.filter((stream) => stream.codec_type === "audio");
  const video = videoStreams[0]; const audio = audioStreams[0]; const durationSeconds = Number(probe.format?.duration ?? 0); const fileSize = Number(probe.format?.size ?? (await stat(file)).size);
  let integratedLoudnessLufs: number | null = null; let truePeakDbfs: number | null = null; let maxVolumeDbfs: number | null = null; let silenceRatio: number | null = null;
  if (audio) {
    const loudness = await callFf("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "loudnorm=I=-16:TP=-1:LRA=11:print_format=json", "-f", "null", "-"]);
    const loudnessText = `${loudness.stdout}\n${loudness.stderr}`;
    integratedLoudnessLufs = Number(loudnessText.match(/"input_i"\s*:\s*"(-?\d+(?:\.\d+)?)"/)?.[1] ?? NaN);
    truePeakDbfs = Number(loudnessText.match(/"input_tp"\s*:\s*"(-?\d+(?:\.\d+)?)"/)?.[1] ?? NaN);
    maxVolumeDbfs = truePeakDbfs;
    const silence = await callFf("ffmpeg", ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "silencedetect=noise=-50dB:d=0.5", "-f", "null", "-"]);
    const silenceDurations = [...`${silence.stdout}\n${silence.stderr}`.matchAll(/silence_duration:\s*(\d+(?:\.\d+)?)/g)].map((match) => Number(match[1]));
    silenceRatio = durationSeconds > 0 ? Math.min(1, silenceDurations.reduce((sum, value) => sum + value, 0) / durationSeconds) : null;
    if (!Number.isFinite(integratedLoudnessLufs)) integratedLoudnessLufs = null;
    if (!Number.isFinite(truePeakDbfs)) truePeakDbfs = null;
    if (!Number.isFinite(maxVolumeDbfs)) maxVolumeDbfs = null;
  }
  return { checksumSha256: await checksumFile(file), container: probe.format?.format_name ?? "unknown", videoCodec: video?.codec_name ?? null, audioCodec: audio?.codec_name ?? null, videoStreamCount: videoStreams.length, audioStreamCount: audioStreams.length, width: video?.width ?? null, height: video?.height ?? null, frameRate: fraction(video?.r_frame_rate), pixelFormat: video?.pix_fmt ?? null, durationSeconds, fileSize, audioSampleRate: audio?.sample_rate ? Number(audio.sample_rate) : null, audioChannels: audio?.channels ?? null, integratedLoudnessLufs, truePeakDbfs, maxVolumeDbfs, silenceRatio };
}

export function evaluateTechnicalMediaQa(inspection: TechnicalMediaInspection, expected: { width: number; height: number; fps: number; durationSeconds: number; audioRequired: boolean; loudnessTargetLufs?: number; loudnessToleranceLu?: number; maxTruePeakDbfs?: number }) {
  const findings: Array<{ code: string; severity: "INFO" | "WARNING" | "BLOCKER"; message: string }> = [];
  const block = (code: string, message: string) => findings.push({ code, severity: "BLOCKER", message });
  if (inspection.videoStreamCount !== 1) block("VIDEO_STREAM_COUNT", `Expected one video stream; found ${inspection.videoStreamCount}`);
  if (inspection.width !== expected.width || inspection.height !== expected.height) block("DIMENSIONS", `Expected ${expected.width}x${expected.height}; found ${inspection.width}x${inspection.height}`);
  if (inspection.frameRate === null || Math.abs(inspection.frameRate - expected.fps) > 0.01) block("FRAME_RATE", `Expected ${expected.fps} fps; found ${inspection.frameRate ?? "unknown"}`);
  if (Math.abs(inspection.durationSeconds - expected.durationSeconds) > Math.max(0.1, 1 / expected.fps)) block("DURATION", `Rendered duration ${inspection.durationSeconds}s does not align with ${expected.durationSeconds}s`);
  if (expected.audioRequired && inspection.audioStreamCount < 1) block("AUDIO_MISSING", "An audio stream is required by the render input");
  if (!expected.audioRequired && inspection.audioStreamCount > 0) block("UNEXPECTED_AUDIO", "Silent render unexpectedly contains audio");
  if (inspection.audioStreamCount > 0) {
    if (inspection.truePeakDbfs !== null && inspection.truePeakDbfs > (expected.maxTruePeakDbfs ?? -1)) block("TRUE_PEAK", `True peak ${inspection.truePeakDbfs} dBFS exceeds the configured ceiling`);
    const target = expected.loudnessTargetLufs ?? -16; const tolerance = expected.loudnessToleranceLu ?? 2;
    if (inspection.integratedLoudnessLufs === null || Math.abs(inspection.integratedLoudnessLufs - target) > tolerance) block("LOUDNESS", `Integrated loudness ${inspection.integratedLoudnessLufs ?? "unknown"} LUFS is outside ${target}±${tolerance} LU`);
    if (inspection.silenceRatio !== null && inspection.silenceRatio > 0.5) block("EXCESSIVE_SILENCE", `Detected silence covers ${(inspection.silenceRatio * 100).toFixed(1)}% of the program`);
  }
  return { verdict: findings.some((finding) => finding.severity === "BLOCKER") ? "FAIL" as const : "PASS" as const, findings };
}
