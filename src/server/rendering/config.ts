import { z } from "zod";

const workerQaConfigSchema = z.object({
  loudnessTargetLufs: z.coerce.number().min(-30).max(-5).default(-16),
  loudnessToleranceLu: z.coerce.number().min(0.1).max(10).default(2),
  maxTruePeakDbfs: z.coerce.number().min(-12).max(0).default(-1),
});

export function readWorkerQaConfig(environment: Readonly<Record<string, string | undefined>> = process.env) {
  return workerQaConfigSchema.parse({
    loudnessTargetLufs: environment.AUDIO_LOUDNESS_TARGET_LUFS,
    loudnessToleranceLu: environment.AUDIO_LOUDNESS_TOLERANCE_LU,
    maxTruePeakDbfs: environment.AUDIO_TRUE_PEAK_MAX_DBFS,
  });
}
