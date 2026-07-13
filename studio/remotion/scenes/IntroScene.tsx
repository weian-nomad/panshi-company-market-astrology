import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Astrolabe } from "../components/Astrolabe";
import { CaptionTrack } from "../components/Captions";
import { EditorialFrame } from "../components/EditorialFrame";
import { Presenter } from "../components/Presenter";
import { COLORS, FONTS, labelStyle } from "../tokens";
import type { IntroScene as IntroSceneProps } from "../types";
import { editorialEnter } from "../utils";

export function IntroScene({ scene, presenterSrc }: { scene: IntroSceneProps; presenterSrc: string }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const titleEnter = spring({
    frame: frame - 8,
    fps,
    config: { damping: 170, mass: 0.9, stiffness: 150 },
    durationInFrames: Math.round(1.1 * fps),
  });
  const hostEnter = editorialEnter(frame, Math.round(0.9 * fps), 14);

  return (
    <EditorialFrame date={scene.date} section="OPENING · 00/06" durationFrames={scene.durationFrames}>
      <div style={{ position: "absolute", right: -72, top: 80, opacity: 0.58 }}>
        <Astrolabe size={520} muted />
      </div>
      <div
        style={{
          opacity: hostEnter,
          transform: `translateX(${(1 - hostEnter) * 34}px)`,
        }}
      >
        <Presenter src={presenterSrc} variant="hero" />
      </div>

      <div style={{ position: "absolute", left: 100, top: 196, width: 530 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 44,
            padding: "0 18px",
            backgroundColor: COLORS.vermilion,
            color: COLORS.paper,
            fontFamily: FONTS.mono,
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: "0.16em",
          }}
        >
          交易日札記 · {scene.dateLabel}
        </div>

        <div
          style={{
            marginTop: 116,
            transform: `translateY(${(1 - titleEnter) * 54}px)`,
            opacity: titleEnter,
          }}
        >
          <div style={{ color: COLORS.brass, fontFamily: FONTS.display, fontSize: 126, fontWeight: 700, lineHeight: 0.92 }}>
            今日
          </div>
          <div style={{ color: COLORS.paper, fontFamily: FONTS.display, fontSize: 146, fontWeight: 700, lineHeight: 1 }}>
            五盤
          </div>
          <div style={{ marginTop: 22, color: COLORS.ash, fontFamily: FONTS.mono, fontSize: 23, letterSpacing: "0.22em" }}>
            FIVE CHARTS · ONE RECORD
          </div>
        </div>

        <div
          style={{
            marginTop: 86,
            width: 410,
            borderTop: `2px solid ${COLORS.brassDark}`,
            paddingTop: 30,
            color: COLORS.paperMuted,
            fontSize: 37,
            fontWeight: 700,
            lineHeight: 1.46,
          }}
        >
          {scene.hook}
        </div>

        <div style={{ marginTop: 54, display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 48,
              height: 48,
              display: "grid",
              placeItems: "center",
              backgroundColor: COLORS.jade,
              color: COLORS.paper,
              fontFamily: FONTS.mono,
              fontSize: 18,
              fontWeight: 600,
            }}
          >
            AI
          </div>
          <div style={{ color: COLORS.paperMuted, fontSize: 25 }}>虛擬觀測員 · {scene.hostName}</div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 100,
          right: 76,
          top: 1204,
          borderTop: `2px solid ${COLORS.rule}`,
          paddingTop: 18,
        }}
      >
        <div style={{ ...labelStyle, marginBottom: 18 }}>TODAY’S INDEX</div>
        {scene.stockIndex.map((item, index) => {
          const enter = editorialEnter(frame, 20, 24 + index * 5);
          return (
            <div
              key={item.symbol}
              style={{
                display: "grid",
                gridTemplateColumns: "54px 138px 1fr 178px",
                alignItems: "baseline",
                minHeight: 58,
                borderTop: index === 0 ? `1px solid ${COLORS.rule}` : undefined,
                borderBottom: `1px solid ${COLORS.rule}`,
                opacity: enter,
                transform: `translateX(${(1 - enter) * 24}px)`,
              }}
            >
              <span style={{ color: COLORS.vermilion, fontFamily: FONTS.mono, fontSize: 20 }}>0{index + 1}</span>
              <span style={{ color: COLORS.paper, fontFamily: FONTS.mono, fontSize: 25 }}>{item.symbol}</span>
              <span style={{ color: COLORS.paperMuted, fontSize: 28, fontWeight: 700 }}>{item.shortName}</span>
              <span style={{ color: COLORS.brass, fontSize: 23, textAlign: "right" }}>{item.categoryLabel}</span>
            </div>
          );
        })}
      </div>

      <CaptionTrack tokens={scene.captionTokens} durationFrames={scene.durationFrames} />
    </EditorialFrame>
  );
}
