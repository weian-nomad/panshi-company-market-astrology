import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { Astrolabe } from "../components/Astrolabe";
import { CaptionTrack } from "../components/Captions";
import { EditorialFrame } from "../components/EditorialFrame";
import { HistoryDistribution } from "../components/HistoryDistribution";
import { Presenter } from "../components/Presenter";
import { COLORS, FONTS, labelStyle } from "../tokens";
import type { StockScene as StockSceneProps } from "../types";
import { editorialEnter, formatNumber, formatSignedPercent } from "../utils";

function MarketCue({ scene }: { scene: StockSceneProps }) {
  if (scene.category === "volume-anomaly") {
    return <>{scene.volumeRatio20SessionMedian === null ? "—" : `${scene.volumeRatio20SessionMedian.toFixed(1)}×`} 近 20 日中位量</>;
  }
  if (scene.category === "dense-aspects") {
    return <>3° 內 {scene.configuration.activeAspectCount} 組主要相位</>;
  }
  if (scene.category === "rare-sample") {
    return <>同組態 {scene.history.sampleSize} 筆完整樣本</>;
  }
  if (scene.category === "historical-divergence") {
    const spread = scene.history.q1Return === null || scene.history.q3Return === null
      ? null
      : scene.history.q3Return - scene.history.q1Return;
    return <>四分位跨度 {spread === null ? "—" : `${spread.toFixed(1)} 個百分點`}</>;
  }
  return <>{formatSignedPercent(scene.dailyChangePercent)} 當日變動</>;
}

export function StockScene({
  scene,
  presenterSrc,
}: {
  scene: StockSceneProps;
  presenterSrc: string;
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const categoryEnter = editorialEnter(frame, 18, 3);
  const companyEnter = spring({
    frame: frame - 8,
    fps,
    durationInFrames: Math.round(0.9 * fps),
    config: { damping: 190, stiffness: 160, mass: 0.8 },
  });
  const numberEnter = editorialEnter(frame, Math.round(0.8 * fps), 16);
  const currentClose = scene.close * numberEnter;
  const ready = scene.history.status === "descriptive-only"
    && scene.history.sampleSize >= scene.history.minimumDescriptiveSample
    && scene.history.medianReturn !== null;
  const configuration = scene.configuration.transitBodyZh
    ? `${scene.configuration.transitGlyph ?? ""} 行運${scene.configuration.transitBodyZh} ${scene.configuration.aspectGlyph ?? ""} ${scene.configuration.aspectZh ?? ""} ${scene.configuration.natalGlyph ?? ""} 本命${scene.configuration.natalBodyZh}`
    : "3° 內沒有可讀取的主要相位";

  return (
    <EditorialFrame
      date={scene.coverage.to ?? "資料日"}
      section={`${String(scene.ordinal).padStart(2, "0")} / 05`}
      durationFrames={scene.durationFrames}
    >
      <Presenter src={presenterSrc} variant="seal" />

      <div
        style={{
          position: "absolute",
          left: 100,
          top: 154,
          display: "flex",
          alignItems: "center",
          gap: 24,
          opacity: categoryEnter,
          transform: `translateX(${(1 - categoryEnter) * -30}px)`,
        }}
      >
        <span style={{ color: COLORS.vermilion, fontFamily: FONTS.mono, fontSize: 36, fontWeight: 600 }}>
          {String(scene.ordinal).padStart(2, "0")}
        </span>
        <span
          style={{
            border: `2px solid ${COLORS.brassDark}`,
            padding: "11px 20px 12px",
            color: COLORS.brass,
            fontSize: 25,
            fontWeight: 700,
            letterSpacing: "0.16em",
          }}
        >
          {scene.categoryLabel}
        </span>
      </div>

      <div
        style={{
          position: "absolute",
          left: 100,
          top: 288,
          width: 710,
          opacity: companyEnter,
          transform: `translateY(${(1 - companyEnter) * 44}px)`,
        }}
      >
        <div style={{ color: COLORS.paper, fontSize: 100, fontWeight: 700, lineHeight: 1.06 }}>
          {scene.shortName}
        </div>
        <div style={{ marginTop: 18, color: COLORS.ash, fontFamily: FONTS.mono, fontSize: 29, letterSpacing: "0.13em" }}>
          {scene.symbol} · {scene.market} · {scene.industry}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 100,
          right: 76,
          top: 500,
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          borderTop: `2px solid ${COLORS.rule}`,
          borderBottom: `2px solid ${COLORS.rule}`,
          padding: "30px 0 28px",
        }}
      >
        <div>
          <div style={labelStyle}>未還原收盤價</div>
          <div style={{ marginTop: 12, color: COLORS.paper, fontFamily: FONTS.mono, fontSize: 66, fontWeight: 600 }}>
            {formatNumber(currentClose)}
          </div>
        </div>
        <div style={{ borderLeft: `1px solid ${COLORS.rule}`, paddingLeft: 42 }}>
          <div style={labelStyle}>今日市場</div>
          <div style={{ marginTop: 19, color: COLORS.brass, fontSize: 32, fontWeight: 700 }}>
            <MarketCue scene={scene} />
          </div>
        </div>
      </div>

      <div style={{ position: "absolute", left: 100, top: 748, width: 494 }}>
        <div style={labelStyle}>現在的盤</div>
        <div style={{ marginTop: 28, color: COLORS.paper, fontSize: 43, fontWeight: 700, lineHeight: 1.45 }}>
          {configuration}
        </div>
        <div style={{ marginTop: 26, color: COLORS.ash, fontFamily: FONTS.mono, fontSize: 22, lineHeight: 1.6 }}>
          ORB {scene.configuration.orb === null ? "—" : `${scene.configuration.orb.toFixed(2)}°`}
          <br />
          ACTIVE {scene.configuration.activeAspectCount} · EXACT SIGNATURE
        </div>
      </div>
      <div style={{ position: "absolute", right: 76, top: 704 }}>
        <Astrolabe
          size={390}
          transitLongitude={scene.configuration.transitLongitude}
          natalLongitude={scene.configuration.natalLongitude}
          transitGlyph={scene.configuration.transitGlyph}
          natalGlyph={scene.configuration.natalGlyph}
          aspectGlyph={scene.configuration.aspectGlyph}
        />
      </div>

      <div style={{ position: "absolute", left: 100, top: 1110, width: 820 }}>
        <HistoryDistribution values={scene.history.caseReturns} horizon={scene.history.horizon} />
      </div>

      <div style={{ position: "absolute", left: 100, top: 1370, width: 820, display: "flex", alignItems: "flex-end", gap: 32 }}>
        <div
          style={{
            color: ready ? COLORS.brass : COLORS.vermilion,
            fontFamily: FONTS.mono,
            fontSize: 84,
            fontWeight: 600,
            lineHeight: 1,
          }}
        >
          {ready ? formatSignedPercent(scene.history.medianReturn) : `${scene.history.sampleSize} 筆`}
        </div>
        <div style={{ paddingBottom: 8, color: COLORS.paperMuted, fontSize: 25, lineHeight: 1.45 }}>
          {ready ? (
            <>
              D+{scene.history.horizon} 中位數
              <br />
              四分位 {formatSignedPercent(scene.history.q1Return)} 至 {formatSignedPercent(scene.history.q3Return)}
            </>
          ) : (
            <>
              同盤樣本不足
              <br />
              未達 {scene.history.minimumDescriptiveSample} 筆，不讀方向
            </>
          )}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          right: 76,
          top: 1510,
          color: COLORS.ash,
          fontFamily: FONTS.mono,
          fontSize: 18,
          letterSpacing: "0.08em",
        }}
      >
        {scene.coverage.sessions} SESSIONS · {scene.coverage.complete ? "COVERAGE COMPLETE" : "COVERAGE PARTIAL"}
      </div>

      <CaptionTrack tokens={scene.captionTokens} durationFrames={scene.durationFrames} />
    </EditorialFrame>
  );
}
