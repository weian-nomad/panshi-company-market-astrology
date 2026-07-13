import { loadFont } from "@remotion/fonts";
import { useEffect, useState } from "react";
import { cancelRender, continueRender, delayRender, staticFile } from "remotion";

let fontPromise: Promise<void> | null = null;

function loadPanshiFonts() {
  if (fontPromise) return fontPromise;
  fontPromise = Promise.all([
    loadFont({
      family: "Panshi Display",
      url: staticFile("studio/fonts/panshi-display.woff2"),
      format: "woff2",
      weight: "400",
      display: "block",
    }),
    loadFont({
      family: "Panshi Display",
      url: staticFile("studio/fonts/panshi-display.woff2"),
      format: "woff2",
      weight: "700",
      display: "block",
    }),
    loadFont({
      family: "Panshi Mono",
      url: staticFile("studio/fonts/ibm-plex-mono-400.woff2"),
      format: "woff2",
      weight: "400",
      display: "block",
    }),
    loadFont({
      family: "Panshi Mono",
      url: staticFile("studio/fonts/ibm-plex-mono-600.woff2"),
      format: "woff2",
      weight: "600",
      display: "block",
    }),
  ]).then(() => undefined);
  return fontPromise;
}

/** Starts font loading only after Remotion has initialized the browser static base. */
export function FontLoader() {
  const [handle] = useState(() => delayRender("Loading Panshi Studio fonts"));

  useEffect(() => {
    loadPanshiFonts()
      .then(() => continueRender(handle))
      .catch((error) => cancelRender(error));
  }, [handle]);

  return null;
}
