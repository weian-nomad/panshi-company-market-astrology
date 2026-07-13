import { Audio } from "@remotion/media";
import { AbsoluteFill, interpolate, Sequence, useVideoConfig } from "remotion";
import { IntroScene } from "./scenes/IntroScene";
import { OutroScene } from "./scenes/OutroScene";
import { StockScene } from "./scenes/StockScene";
import { FontLoader } from "./fonts";
import type { RemotionVideoProps, RemotionVideoScene } from "./types";
import { publicAsset, validateRemotionVideoProps } from "./utils";

function SceneAudio({ scene }: { scene: RemotionVideoScene }) {
  if (!scene.audioSrc.trim()) return null;
  return (
    <Audio
      src={publicAsset(scene.audioSrc)}
      trimAfter={scene.durationFrames}
      volume={(frame) => interpolate(
        frame,
        [0, Math.min(4, scene.durationFrames - 1), Math.max(5, scene.durationFrames - 5), scene.durationFrames - 1],
        [0, 1, 1, 0],
        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
      )}
    />
  );
}

function SceneView({ scene, props }: { scene: RemotionVideoScene; props: RemotionVideoProps }) {
  if (scene.kind === "intro") return <IntroScene scene={scene} presenterSrc={props.presenterSrc} />;
  if (scene.kind === "outro") {
    return <OutroScene scene={scene} presenterSrc={props.presenterSrc} date={props.date} hostName={props.hostName} />;
  }
  return <StockScene scene={scene} presenterSrc={props.presenterSrc} />;
}

export function DailyFive(props: RemotionVideoProps) {
  validateRemotionVideoProps(props);
  const { fps } = useVideoConfig();
  const timeline = props.scenes.map((scene, index) => ({
    scene,
    from: props.scenes.slice(0, index).reduce((sum, previous) => sum + previous.durationFrames, 0),
  }));

  return (
    <AbsoluteFill>
      <FontLoader />
      {timeline.map(({ scene, from }) => {
        return (
          <Sequence
            key={scene.id}
            from={from}
            durationInFrames={scene.durationFrames}
            premountFor={fps}
          >
            <SceneView scene={scene} props={props} />
            <SceneAudio scene={scene} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
