import { useCurrentFrame } from "remotion";
import { Astrolabe } from "../components/Astrolabe";
import { CaptionTrack } from "../components/Captions";
import { EditorialFrame } from "../components/EditorialFrame";
import { Presenter } from "../components/Presenter";
import { COLORS, FONTS, labelStyle } from "../tokens";
import type { OutroScene as OutroSceneProps } from "../types";
import { editorialEnter } from "../utils";

export function OutroScene({
  scene,
  presenterSrc,
  date,
  hostName,
}: {
  scene: OutroSceneProps;
  presenterSrc: string;
  date: string;
  hostName: string;
}) {
  const frame = useCurrentFrame();
  const titleEnter = editorialEnter(frame, 28, 6);

  return (
    <EditorialFrame date={date} section="CLOSING · 06/06" durationFrames={scene.durationFrames}>
      <div style={{ position: "absolute", right: -88, top: 52, opacity: 0.46 }}>
        <Astrolabe size={510} muted />
      </div>
      <Presenter src={presenterSrc} variant="column" />

      <div
        style={{
          position: "absolute",
          left: 100,
          top: 206,
          width: 550,
          opacity: titleEnter,
          transform: `translateY(${(1 - titleEnter) * 38}px)`,
        }}
      >
        <div style={{ ...labelStyle, color: COLORS.vermilion }}>CLOSE THE LOOP</div>
        <div style={{ marginTop: 62, color: COLORS.paper, fontSize: 88, fontWeight: 700, lineHeight: 1.14 }}>
          不是排行
        </div>
        <div style={{ marginTop: 12, color: COLORS.brass, fontSize: 61, fontWeight: 700, lineHeight: 1.26 }}>
          是五種回看角度
        </div>
        <div style={{ marginTop: 58, width: 430, borderTop: `2px solid ${COLORS.brassDark}`, paddingTop: 28, color: COLORS.paperMuted, fontSize: 32, lineHeight: 1.56 }}>
          {scene.boundaryLine}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 100,
          right: 76,
          top: 890,
          borderTop: `2px solid ${COLORS.rule}`,
        }}
      >
        {scene.stockIndex.map((item, index) => {
          const enter = editorialEnter(frame, 18, 18 + index * 5);
          return (
            <div
              key={item.symbol}
              style={{
                display: "grid",
                gridTemplateColumns: "64px 180px 1fr",
                alignItems: "center",
                minHeight: 74,
                borderBottom: `1px solid ${COLORS.rule}`,
                opacity: enter,
                transform: `translateX(${(1 - enter) * 30}px)`,
              }}
            >
              <span style={{ color: COLORS.vermilion, fontFamily: FONTS.mono, fontSize: 18 }}>0{index + 1}</span>
              <span style={{ color: COLORS.paper, fontFamily: FONTS.mono, fontSize: 26 }}>{item.symbol}</span>
              <span style={{ color: COLORS.brass, fontSize: 26 }}>{item.categoryLabel}</span>
            </div>
          );
        })}
      </div>

      <div
        style={{
          position: "absolute",
          left: 100,
          right: 76,
          top: 1338,
          minHeight: 220,
          border: `2px solid ${COLORS.brassDark}`,
          backgroundColor: COLORS.inkRaised,
          padding: "32px 38px",
        }}
      >
        <div style={labelStyle}>完整研究頁 · 案例 · 反例 · 資料缺口</div>
        <div style={{ marginTop: 26, color: COLORS.paper, fontSize: 43, fontWeight: 700 }}>
          到盤勢，輸入股票代號
        </div>
        <div style={{ marginTop: 19, color: COLORS.brass, fontFamily: FONTS.mono, fontSize: 25, letterSpacing: "0.04em" }}>
          PANSHI.NOMADSUSTAINTECH.COM
        </div>
      </div>

      <div style={{ position: "absolute", left: 100, top: 1612, display: "flex", alignItems: "center", gap: 18 }}>
        <div style={{ width: 46, height: 46, display: "grid", placeItems: "center", backgroundColor: COLORS.jade, color: COLORS.paper, fontFamily: FONTS.mono, fontSize: 17, fontWeight: 600 }}>
          AI
        </div>
        <span style={{ color: COLORS.ash, fontSize: 23 }}>{hostName} · AI 虛擬觀測員</span>
      </div>

      <CaptionTrack tokens={scene.captionTokens} durationFrames={scene.durationFrames} />
    </EditorialFrame>
  );
}
