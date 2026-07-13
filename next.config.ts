import type { NextConfig } from "next";
import { APP_BASE_PATH } from "./lib/app-config.ts";

const WEB_TRACE_EXCLUDES = [
  ".agents/**/*",
  ".env*",
  "deploy/**/*",
  "docs/**/*",
  "node_modules/.cache/**/*",
  "outputs/**/*",
  "scripts/**/*",
  "studio/**/*",
  "tests/**/*",
  "var/**/*",
  "work/**/*",
  "*.md",
  "*.tsbuildinfo",
  "Dockerfile*",
];

const nextConfig: NextConfig = {
  basePath: APP_BASE_PATH,
  output: "standalone",
  // The Studio media route opens files from a mounted runtime volume. Without
  // explicit exclusions, static file tracing treats that dynamic path as a
  // reason to copy unrelated local artifacts into the Web image.
  outputFileTracingExcludes: {
    "/*": WEB_TRACE_EXCLUDES,
    // Next's shared server trace has a separate synthetic key. Exclude only
    // build caches here; applying route-source globs to it can prune Next's
    // own transitive runtime files.
    "next-server": ["node_modules/.cache/**/*"],
  },
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
