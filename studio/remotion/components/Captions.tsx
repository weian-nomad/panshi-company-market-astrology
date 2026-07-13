import { AbsoluteFill, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../tokens";
import type { SerializedCaptionToken } from "../types";

function CaptionPage({ text }: { text: string }) {
  const frame = useCurrentFrame();
  const enter = interpolate(frame, [0, 4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const parts = text.trim().split(/([+-]?\d+(?:\.\d+)?%?|D\+\d+|[A-Z]{2,})/gu).filter(Boolean);

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", padding: "0 92px 226px 100px", pointerEvents: "none" }}>
      <div
        style={{
          alignSelf: "flex-start",
          maxWidth: 850,
          borderLeft: `5px solid ${COLORS.vermilion}`,
          backgroundColor: COLORS.inkRaised,
          padding: "18px 24px 20px 28px",
          color: COLORS.paper,
          fontFamily: FONTS.display,
          fontSize: 42,
          fontWeight: 700,
          lineHeight: 1.35,
          letterSpacing: "0.02em",
          whiteSpace: "pre-wrap",
          opacity: enter,
          transform: `translateY(${(1 - enter) * 12}px)`,
        }}
      >
        {parts.map((part, index) => (
          <span
            key={`${part}-${index}`}
            style={{ color: /^(?:[+-]?\d|D\+|[A-Z]{2,})/u.test(part) ? COLORS.brass : COLORS.paper }}
          >
            {part}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
}

export function CaptionTrack({ tokens, durationFrames }: { tokens: SerializedCaptionToken[]; durationFrames: number }) {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill>
      {tokens.map((token, index) => {
        const nextToken = tokens[index + 1] ?? null;
        const startFrame = Math.max(0, Math.round((token.startMs / 1000) * fps));
        const naturalEnd = Math.round((token.endMs / 1000) * fps);
        const nextPageStart = nextToken
          ? Math.round((nextToken.startMs / 1000) * fps)
          : durationFrames;
        const endFrame = Math.min(
          durationFrames,
          Math.max(startFrame + 1, Math.min(naturalEnd, nextPageStart)),
        );
        const pageDuration = endFrame - startFrame;
        if (pageDuration <= 0 || startFrame >= durationFrames) return null;
        return (
          <Sequence
            key={`${token.startMs}-${index}`}
            from={startFrame}
            durationInFrames={pageDuration}
            premountFor={fps}
          >
            <CaptionPage text={token.text} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
