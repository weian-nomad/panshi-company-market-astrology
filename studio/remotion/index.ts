import { registerRoot } from "remotion";
import { RemotionRoot } from "./Root";

registerRoot(RemotionRoot);

export { mapDailyContentPackageToRemotionProps } from "./map-content";
export type {
  RemotionMediaBundle,
  RemotionSceneMedia,
  RemotionVideoProps,
  SerializedCaptionToken,
} from "./types";
