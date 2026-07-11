import type { NextConfig } from "next";
import { APP_BASE_PATH } from "./lib/app-config";

const nextConfig: NextConfig = {
  basePath: APP_BASE_PATH,
  output: "standalone",
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
