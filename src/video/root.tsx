import { Composition, type CalculateMetadataFunction } from "remotion";
import { ChannelwrightMaster } from "./compositions/channelwright-master";
import {
  calculateDurationInFrames,
  deterministicSampleInput,
  renderInputSchema,
  VIDEO_FPS,
  VIDEO_HEIGHT,
  VIDEO_WIDTH,
  type RenderInput,
} from "./schemas/render-input";

const calculateMetadata: CalculateMetadataFunction<RenderInput> = ({ props }) => {
  const validated = renderInputSchema.parse(props);
  return {
    durationInFrames: calculateDurationInFrames(validated),
    fps: VIDEO_FPS,
    width: VIDEO_WIDTH,
    height: VIDEO_HEIGHT,
    props: validated,
    defaultCodec: "h264",
    defaultOutName: "channelwright-master.mp4",
  };
};

export function RemotionRoot() {
  return (
    <Composition
      id="ChannelwrightMaster"
      component={ChannelwrightMaster}
      calculateMetadata={calculateMetadata}
      defaultProps={deterministicSampleInput}
    />
  );
}
