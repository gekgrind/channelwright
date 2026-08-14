import { mkdir } from "node:fs/promises";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { renderInputSchema, type RenderInput } from "@/video/schemas/render-input";

const COMPOSITION_ID = "ChannelwrightMaster";
const RENDER_OUTPUT_ROOT = path.resolve(process.cwd(), "renders");

function resolveSafeOutputPath(outputPath: string) {
  if (!outputPath.trim() || outputPath.includes("\0")) throw new Error("A valid render output path is required");

  const resolved = path.resolve(outputPath);
  const relative = path.relative(RENDER_OUTPUT_ROOT, resolved);
  const escapesOutputRoot = relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);

  if (escapesOutputRoot) throw new Error(`Render output must stay inside ${RENDER_OUTPUT_ROOT}`);
  if (path.extname(resolved).toLowerCase() !== ".mp4") throw new Error("The first rendering slice only writes .mp4 files");

  return resolved;
}

export async function renderVideo(
  input: unknown,
  outputPath: string,
  options: { publicDir?: string } = {},
): Promise<{ outputPath: string; input: RenderInput }> {
  const validatedInput = renderInputSchema.parse(input);
  const safeOutputPath = resolveSafeOutputPath(outputPath);
  await mkdir(path.dirname(safeOutputPath), { recursive: true });

  const serveUrl = await bundle({
    entryPoint: path.resolve(process.cwd(), "src/video/index.ts"),
    publicDir: options.publicDir,
    webpackOverride: (configuration) => configuration,
  });
  const composition = await selectComposition({
    serveUrl,
    id: COMPOSITION_ID,
    inputProps: validatedInput,
  });

  await renderMedia({
    composition,
    serveUrl,
    codec: "h264",
    pixelFormat: "yuv420p",
    inputProps: validatedInput,
    outputLocation: safeOutputPath,
    overwrite: false,
    muted: validatedInput.audioTracks.length === 0,
    audioCodec: validatedInput.audioTracks.length === 0 ? undefined : "aac",
  });

  return { outputPath: safeOutputPath, input: validatedInput };
}
