import { createTikTokStyleCaptions, type TikTokPage } from "@remotion/captions";
import { useMemo } from "react";
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../tokens";
import type { SerializedCaptionToken } from "../types";

const PAGE_MS = 1180;

function CaptionPage({ page }: { page: TikTokPage }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const absoluteTimeMs = page.startMs + (frame / fps) * 1000;

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
        }}
      >
        {page.tokens.map((token, index) => {
          const active = token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;
          return (
            <span
              key={`${token.fromMs}-${index}`}
              style={{ color: active ? COLORS.brass : COLORS.paper }}
            >
              {token.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
}

export function CaptionTrack({ tokens, durationFrames }: { tokens: SerializedCaptionToken[]; durationFrames: number }) {
  const { fps } = useVideoConfig();
  const { pages } = useMemo(
    () => createTikTokStyleCaptions({ captions: tokens, combineTokensWithinMilliseconds: PAGE_MS }),
    [tokens],
  );

  return (
    <AbsoluteFill>
      {pages.map((page, index) => {
        const nextPage = pages[index + 1] ?? null;
        const startFrame = Math.max(0, Math.round((page.startMs / 1000) * fps));
        const naturalEnd = Math.round(((page.startMs + page.durationMs) / 1000) * fps);
        const nextPageStart = nextPage
          ? Math.round((nextPage.startMs / 1000) * fps)
          : durationFrames;
        const endFrame = Math.min(
          durationFrames,
          Math.max(startFrame + 1, Math.min(naturalEnd, nextPageStart)),
        );
        const pageDuration = endFrame - startFrame;
        if (pageDuration <= 0 || startFrame >= durationFrames) return null;
        return (
          <Sequence
            key={`${page.startMs}-${index}`}
            from={startFrame}
            durationInFrames={pageDuration}
            premountFor={fps}
          >
            <CaptionPage page={page} />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
}
