import { evolvePath } from "@remotion/paths";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../tokens";

type AstrolabeProps = {
  transitLongitude?: number | null;
  natalLongitude?: number | null;
  transitGlyph?: string | null;
  natalGlyph?: string | null;
  aspectGlyph?: string | null;
  size?: number;
  muted?: boolean;
};

function pointFor(longitude: number, center: number, radius: number) {
  const angle = ((longitude - 90) * Math.PI) / 180;
  return {
    x: center + Math.cos(angle) * radius,
    y: center + Math.sin(angle) * radius,
  };
}

export function Astrolabe({
  transitLongitude = 34,
  natalLongitude = 214,
  transitGlyph = "♄",
  natalGlyph = "☉",
  aspectGlyph = "△",
  size = 390,
  muted = false,
}: AstrolabeProps) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const center = size / 2;
  const transit = pointFor(transitLongitude ?? 34, center, size * 0.38);
  const natal = pointFor(natalLongitude ?? 214, center, size * 0.38);
  const path = `M ${transit.x} ${transit.y} L ${natal.x} ${natal.y}`;
  const progress = interpolate(frame, [0.3 * fps, 1.35 * fps], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const { strokeDasharray, strokeDashoffset } = evolvePath(progress, path);
  const rotation = (frame / fps) * (muted ? 1.4 : 3.2);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <g transform={`rotate(${rotation} ${center} ${center})`}>
        <circle cx={center} cy={center} r={size * 0.45} fill="none" stroke={COLORS.rule} strokeWidth="2" />
        <circle
          cx={center}
          cy={center}
          r={size * 0.35}
          fill="none"
          stroke={muted ? COLORS.brassDark : COLORS.jade}
          strokeWidth="2"
          strokeDasharray="3 13"
        />
        {Array.from({ length: 12 }, (_, index) => {
          const angle = (index / 12) * Math.PI * 2;
          const inner = size * 0.425;
          const outer = size * 0.455;
          return (
            <line
              key={index}
              x1={center + Math.cos(angle) * inner}
              y1={center + Math.sin(angle) * inner}
              x2={center + Math.cos(angle) * outer}
              y2={center + Math.sin(angle) * outer}
              stroke={COLORS.brassDark}
              strokeWidth={index % 3 === 0 ? 3 : 1}
            />
          );
        })}
      </g>
      <path
        d={path}
        fill="none"
        stroke={muted ? COLORS.brassDark : COLORS.vermilion}
        strokeWidth="3"
        strokeDasharray={strokeDasharray}
        strokeDashoffset={strokeDashoffset}
      />
      <circle cx={transit.x} cy={transit.y} r="16" fill={COLORS.ink} stroke={COLORS.brass} strokeWidth="2" />
      <circle cx={natal.x} cy={natal.y} r="16" fill={COLORS.ink} stroke={COLORS.jade} strokeWidth="2" />
      <text x={transit.x} y={transit.y + 7} textAnchor="middle" fill={COLORS.paper} fontFamily={FONTS.display} fontSize="22">
        {transitGlyph}
      </text>
      <text x={natal.x} y={natal.y + 7} textAnchor="middle" fill={COLORS.paper} fontFamily={FONTS.display} fontSize="22">
        {natalGlyph}
      </text>
      <text x={center} y={center + 12} textAnchor="middle" fill={COLORS.brass} fontFamily={FONTS.display} fontSize="42">
        {aspectGlyph}
      </text>
    </svg>
  );
}
