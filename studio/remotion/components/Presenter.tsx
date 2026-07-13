import { Img, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS } from "../tokens";
import { publicAsset } from "../utils";

type PresenterProps = {
  src: string;
  variant: "hero" | "seal" | "column";
};

const variantStyle = {
  hero: { left: 470, top: 178, width: 610, height: 1115, radius: "0" },
  seal: { left: 816, top: 118, width: 190, height: 250, radius: "95px" },
  column: { left: 586, top: 220, width: 418, height: 1000, radius: "210px 210px 0 0" },
} as const;

export function Presenter({ src, variant }: PresenterProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const style = variantStyle[variant];
  const breathing = 1 + Math.sin((frame / fps) * Math.PI * 0.72) * 0.008;
  const parallaxX = Math.sin((frame / fps) * Math.PI * 0.24) * (variant === "seal" ? 2 : 8);
  const parallaxY = interpolate(Math.sin((frame / fps) * Math.PI * 0.36), [-1, 1], [-5, 5]);

  return (
    <div
      style={{
        position: "absolute",
        left: style.left,
        top: style.top,
        width: style.width,
        height: style.height,
        borderRadius: style.radius,
        overflow: "hidden",
        border: variant === "seal" ? `2px solid ${COLORS.brassDark}` : `1px solid ${COLORS.rule}`,
        backgroundColor: COLORS.inkRaised,
      }}
    >
      <Img
        src={publicAsset(src)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: variant === "seal" ? "50% 10%" : "50% 0%",
          transform: `translate3d(${parallaxX}px, ${parallaxY}px, 0) scale(${breathing})`,
          transformOrigin: "50% 38%",
          opacity: variant === "seal" ? 0.9 : 0.94,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: variant === "seal" ? "auto 0 0" : "auto 0 0",
          height: variant === "seal" ? 52 : 128,
          backgroundColor: COLORS.ink,
          opacity: variant === "seal" ? 0.48 : 0.72,
        }}
      />
    </div>
  );
}
