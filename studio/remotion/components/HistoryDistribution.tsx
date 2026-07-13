import { spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../tokens";

type HistoryDistributionProps = {
  values: number[];
  horizon: number;
  width?: number;
  height?: number;
};

export function HistoryDistribution({ values, horizon, width = 820, height = 220 }: HistoryDistributionProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const shown = values.slice(-24);
  const extent = Math.max(1, ...shown.map((value) => Math.abs(value)));
  const center = width / 2;
  const axisY = 112;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      <line x1="0" y1={axisY} x2={width} y2={axisY} stroke={COLORS.rule} strokeWidth="2" />
      <line x1={center} y1="68" x2={center} y2="158" stroke={COLORS.paperMuted} strokeWidth="2" />
      <text x="0" y="205" fill={COLORS.ash} fontFamily={FONTS.mono} fontSize="18" letterSpacing="0.12em">
        D+{horizon} · HISTORICAL CASE DISTRIBUTION
      </text>
      {shown.length === 0 ? (
        <text x="0" y="82" fill={COLORS.ash} fontFamily={FONTS.display} fontSize="28">
          尚無可完成觀察的同盤案例
        </text>
      ) : null}
      {shown.map((value, index) => {
        const enter = spring({
          frame: frame - 10 - index * 2,
          fps,
          config: { damping: 180, mass: 0.7, stiffness: 160 },
        });
        const x = center + (value / extent) * (width * 0.43);
        const y = axisY - 17 - (index % 4) * 26;
        const color = value > 0 ? COLORS.brass : value < 0 ? COLORS.vermilion : COLORS.ash;
        return (
          <g key={`${index}-${value}`} transform={`translate(${x} ${y}) scale(${enter})`}>
            <circle r={8 + (index % 3)} fill={color} opacity={0.72 + (index % 4) * 0.07} />
          </g>
        );
      })}
    </svg>
  );
}
