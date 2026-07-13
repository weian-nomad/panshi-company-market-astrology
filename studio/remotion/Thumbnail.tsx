import { AbsoluteFill } from "remotion";
import { Astrolabe } from "./components/Astrolabe";
import { Presenter } from "./components/Presenter";
import { FontLoader } from "./fonts";
import { COLORS, FONTS } from "./tokens";
import type { RemotionVideoProps } from "./types";
import { formatDateDot } from "./utils";

export function DailyFiveThumbnail(props: RemotionVideoProps) {
  const intro = props.scenes[0];
  return (
    <AbsoluteFill style={{ backgroundColor: COLORS.ink, color: COLORS.paper, fontFamily: FONTS.display, overflow: "hidden" }}>
      <FontLoader />
      <svg width="1080" height="1920" viewBox="0 0 1080 1920" style={{ position: "absolute", inset: 0 }}>
        <line x1="76" y1="92" x2="76" y2="1810" stroke={COLORS.vermilion} strokeWidth="6" />
        <line x1="76" y1="92" x2="1004" y2="92" stroke={COLORS.rule} strokeWidth="2" />
        <line x1="76" y1="1810" x2="1004" y2="1810" stroke={COLORS.rule} strokeWidth="2" />
      </svg>
      <div style={{ position: "absolute", right: -85, top: 6, opacity: 0.54 }}>
        <Astrolabe size={590} muted />
      </div>
      <Presenter src={props.presenterSrc} variant="hero" />

      <div style={{ position: "absolute", left: 100, top: 166, width: 550 }}>
        <div style={{ display: "inline-block", backgroundColor: COLORS.vermilion, padding: "12px 19px", color: COLORS.paper, fontFamily: FONTS.mono, fontSize: 21, fontWeight: 600, letterSpacing: "0.16em" }}>
          交易日札記 · {formatDateDot(props.date)}
        </div>
        <div style={{ marginTop: 132, color: COLORS.brass, fontSize: 132, fontWeight: 700, lineHeight: 0.9 }}>今日</div>
        <div style={{ color: COLORS.paper, fontSize: 156, fontWeight: 700, lineHeight: 1.06 }}>五盤</div>
        <div style={{ marginTop: 28, color: COLORS.ash, fontFamily: FONTS.mono, fontSize: 24, letterSpacing: "0.2em" }}>
          FIVE CHARTS · ONE RECORD
        </div>
        <div style={{ marginTop: 94, width: 430, borderTop: `2px solid ${COLORS.brassDark}`, paddingTop: 34, color: COLORS.paperMuted, fontSize: 40, fontWeight: 700, lineHeight: 1.45 }}>
          {intro.hook}
        </div>
      </div>

      <div style={{ position: "absolute", left: 100, right: 76, top: 1320 }}>
        {intro.stockIndex.map((item, index) => (
          <div key={item.symbol} style={{ display: "grid", gridTemplateColumns: "54px 150px 1fr 170px", alignItems: "baseline", minHeight: 69, borderBottom: `1px solid ${COLORS.rule}` }}>
            <span style={{ color: COLORS.vermilion, fontFamily: FONTS.mono, fontSize: 20 }}>0{index + 1}</span>
            <span style={{ color: COLORS.paper, fontFamily: FONTS.mono, fontSize: 27 }}>{item.symbol}</span>
            <span style={{ color: COLORS.paperMuted, fontSize: 29, fontWeight: 700 }}>{item.shortName}</span>
            <span style={{ color: COLORS.brass, fontSize: 23, textAlign: "right" }}>{item.categoryLabel}</span>
          </div>
        ))}
      </div>

      <div style={{ position: "absolute", left: 100, right: 76, bottom: 54, display: "flex", justifyContent: "space-between", color: COLORS.ash, fontFamily: FONTS.mono, fontSize: 18, letterSpacing: "0.14em" }}>
        <span>盤勢 · NOMAD SUSTAINTECH · AI 虛擬觀測員</span>
        <span>財經文化研究</span>
      </div>
    </AbsoluteFill>
  );
}
