import type { CSSProperties } from "react";

export const COLORS = {
  ink: "#0B0C0A",
  inkRaised: "#151512",
  paper: "#EFE8D6",
  paperMuted: "#BEB39E",
  ash: "#776F63",
  vermilion: "#B43C2E",
  vermilionDark: "#6E261F",
  brass: "#C29D54",
  brassDark: "#675434",
  jade: "#28736B",
  jadeDark: "#153F3B",
  rule: "#3B372F",
} as const;

export const FONTS = {
  display: '"Panshi Display", "Noto Serif TC", serif',
  mono: '"Panshi Mono", "IBM Plex Mono", monospace',
} as const;

export const SAFE = {
  left: 76,
  right: 76,
  top: 92,
  bottom: 116,
} as const;

export const EASE = {
  editorial: [0.16, 1, 0.3, 1] as const,
  measured: [0.45, 0, 0.55, 1] as const,
} as const;

export const absoluteFill: CSSProperties = {
  position: "absolute",
  inset: 0,
  width: "100%",
  height: "100%",
};

export const labelStyle: CSSProperties = {
  color: COLORS.ash,
  fontFamily: FONTS.mono,
  fontSize: 22,
  fontWeight: 600,
  letterSpacing: "0.18em",
  lineHeight: 1,
  textTransform: "uppercase",
};
