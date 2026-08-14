import { Audio, Sequence, interpolate, staticFile } from "remotion";
import type { RenderInput } from "../schemas/render-input";
import { secondsToFrames, VIDEO_FPS } from "../schemas/render-input";

const decibelsToAmplitude = (decibels: number) => 10 ** (decibels / 20);

const playbackSource = (reference: string) => reference.startsWith("public://")
  ? staticFile(reference.slice("public://".length))
  : reference;

export function AudioMix({ audioTracks, narrationDucking }: Pick<RenderInput, "audioTracks" | "narrationDucking">) {
  const narration = audioTracks.filter((track) => track.role === "NARRATION");

  return audioTracks.map((track) => {
    const from = Math.round(track.startSeconds * VIDEO_FPS);
    const durationInFrames = secondsToFrames(track.durationSeconds);
    const trimBefore = Math.round(track.trimStartSeconds * VIDEO_FPS);
    const baseVolume = decibelsToAmplitude(track.gainDb);

    return (
      <Sequence key={track.assetVersionId} from={from} durationInFrames={durationInFrames} premountFor={VIDEO_FPS}>
        <Audio
          name={`${track.role.toLowerCase()}:${track.assetVersionId}`}
          src={playbackSource(track.reference)}
          trimBefore={trimBefore}
          volume={(relativeFrame) => {
            const relativeSeconds = relativeFrame / VIDEO_FPS;
            const fadeIn = track.fadeInSeconds === 0 ? 1 : interpolate(relativeSeconds, [0, track.fadeInSeconds], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            const fadeOutStart = track.durationSeconds - track.fadeOutSeconds;
            const fadeOut = track.fadeOutSeconds === 0 ? 1 : interpolate(relativeSeconds, [fadeOutStart, track.durationSeconds], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
            if (track.role !== "MUSIC" || !narrationDucking.enabled) return baseVolume * fadeIn * fadeOut;

            const absoluteSeconds = track.startSeconds + relativeSeconds;
            const activeNarration = narration.find((candidate) => absoluteSeconds >= candidate.startSeconds && absoluteSeconds < candidate.startSeconds + candidate.durationSeconds);
            if (!activeNarration) return baseVolume * fadeIn * fadeOut;
            const sinceStart = absoluteSeconds - activeNarration.startSeconds;
            const untilEnd = activeNarration.startSeconds + activeNarration.durationSeconds - absoluteSeconds;
            const attack = narrationDucking.attackSeconds === 0 ? 1 : Math.min(1, sinceStart / narrationDucking.attackSeconds);
            const release = narrationDucking.releaseSeconds === 0 ? 1 : Math.min(1, untilEnd / narrationDucking.releaseSeconds);
            const envelope = Math.min(attack, release);
            const ducked = interpolate(envelope, [0, 1], [1, decibelsToAmplitude(narrationDucking.amountDb)]);
            return baseVolume * fadeIn * fadeOut * ducked;
          }}
        />
      </Sequence>
    );
  });
}
