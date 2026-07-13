import type { CalculateMetadataFunction } from "remotion";
import { Composition, Folder, Still } from "remotion";
import { DailyFive } from "./DailyFive";
import { defaultRemotionVideoProps } from "./default-props";
import { DailyFiveThumbnail } from "./Thumbnail";
import {
  REMOTION_FPS,
  REMOTION_HEIGHT,
  REMOTION_WIDTH,
  type RemotionVideoProps,
} from "./types";
import { totalDurationFrames, validateRemotionVideoProps } from "./utils";

export const calculateDailyFiveMetadata: CalculateMetadataFunction<RemotionVideoProps> = ({ props }) => {
  const durationInFrames = validateRemotionVideoProps(props);
  return {
    durationInFrames,
    fps: REMOTION_FPS,
    width: REMOTION_WIDTH,
    height: REMOTION_HEIGHT,
    defaultOutName: `今日五盤-${props.date}.mp4`,
    defaultCodec: "h264",
  };
};

export function RemotionRoot() {
  return (
    <Folder name="Panshi-Studio">
      <Composition
        id="DailyFive"
        component={DailyFive}
        width={REMOTION_WIDTH}
        height={REMOTION_HEIGHT}
        fps={REMOTION_FPS}
        durationInFrames={totalDurationFrames(defaultRemotionVideoProps)}
        defaultProps={defaultRemotionVideoProps}
        calculateMetadata={calculateDailyFiveMetadata}
      />
      <Still
        id="DailyFiveThumbnail"
        component={DailyFiveThumbnail}
        width={REMOTION_WIDTH}
        height={REMOTION_HEIGHT}
        defaultProps={defaultRemotionVideoProps}
      />
    </Folder>
  );
}
