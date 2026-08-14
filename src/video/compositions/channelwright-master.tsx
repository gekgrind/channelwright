import { AbsoluteFill, Sequence } from "remotion";
import { Captions } from "../components/captions";
import { Scene } from "../components/scene";
import { AudioMix } from "../components/audio-mix";
import { renderInputSchema, secondsToFrames, type RenderInput } from "../schemas/render-input";

export function ChannelwrightMaster(input: RenderInput) {
  const validated = renderInputSchema.parse(input);

  return (
    <AbsoluteFill style={{ backgroundColor: "#020617" }}>
      {validated.scenes.map((scene, sceneIndex) => {
        const durationInFrames = secondsToFrames(scene.durationSeconds);
        const from = validated.scenes
          .slice(0, sceneIndex)
          .reduce((total, precedingScene) => total + secondsToFrames(precedingScene.durationSeconds), 0);

        return (
          <Sequence key={scene.id} from={from} durationInFrames={durationInFrames} premountFor={10}>
            <Scene scene={scene} sceneIndex={sceneIndex} durationInFrames={durationInFrames} />
          </Sequence>
        );
      })}
      <Captions captions={validated.captions} />
      <AudioMix audioTracks={validated.audioTracks} narrationDucking={validated.narrationDucking} />
    </AbsoluteFill>
  );
}
