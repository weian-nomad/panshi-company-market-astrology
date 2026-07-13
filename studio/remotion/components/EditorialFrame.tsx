import type { ReactNode } from "react";
import { AbsoluteFill, Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS, SAFE } from "../tokens";
import { formatDateDot } from "../utils";

type EditorialFrameProps = {
  children: ReactNode;
  date: string;
  section: string;
  durationFrames: number;
};

export function EditorialFrame({ children, date, section, durationFrames }: EditorialFrameProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ruleProgress = interpolate(frame, [0, 0.8 * fps], [0, 1], {
    easing: Easing.bezier(0.16, 1, 0.3, 1),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const veil = interpolate(
    frame,
    [0, Math.min(7, durationFrames - 1), Math.max(8, durationFrames - 7), durationFrames - 1],
    [1, 0, 0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  return (
    <AbsoluteFill
      style={{
        backgroundColor: COLORS.ink,
        color: COLORS.paper,
        fontFamily: FONTS.display,
        overflow: "hidden",
      }}
    >
      <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
        <line x1="76" y1="92" x2="1004" y2="92" stroke={COLORS.rule} strokeWidth="2" />
        <line x1="76" y1="1810" x2="1004" y2="1810" stroke={COLORS.rule} strokeWidth="2" />
        <line
          x1="76"
          y1="92"
          x2="76"
          y2={92 + 1718 * ruleProgress}
          stroke={COLORS.vermilion}
          strokeWidth="5"
        />
        <circle cx="965" cy="92" r="5" fill={COLORS.brass} />
      </svg>

      <div
        style={{
          position: "absolute",
          top: 42,
          left: SAFE.left + 24,
          right: SAFE.right,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: COLORS.ash,
          fontFamily: FONTS.mono,
          fontSize: 19,
          fontWeight: 600,
          letterSpacing: "0.18em",
        }}
      >
        <span>盤勢 · NOMAD DAILY LEDGER</span>
        <span>{formatDateDot(date)}</span>
      </div>

      {children}

      <div
        style={{
          position: "absolute",
          left: SAFE.left + 24,
          right: SAFE.right,
          bottom: 56,
          display: "flex",
          justifyContent: "space-between",
          color: COLORS.ash,
          fontFamily: FONTS.mono,
          fontSize: 18,
          letterSpacing: "0.14em",
        }}
      >
        <span>AI 虛擬觀測員 · 未還原收盤價</span>
        <span>{section}</span>
      </div>

      <AbsoluteFill
        style={{
          backgroundColor: COLORS.ink,
          opacity: veil,
          pointerEvents: "none",
        }}
      />
    </AbsoluteFill>
  );
}
