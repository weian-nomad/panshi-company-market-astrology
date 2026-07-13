import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const standaloneRoot = resolve(".next/standalone");
const forbiddenDirectories = [
  ".agents",
  "deploy",
  "docs",
  "node_modules/.cache",
  "node_modules/@remotion",
  "node_modules/remotion",
  "outputs",
  "public/studio",
  "studio/assets",
  "studio/commands",
  "studio/remotion",
  "tests",
  "var",
  "work",
];
const forbiddenFile = /(?:^|\/)(?:\.env(?:\.|$)|[^/]+\.(?:db|db-shm|db-wal|key|p12|pfx|pem)$)/u;
const forbiddenWorkerSource = /^studio\/(?:oauth-handoff|render|vault|voice|youtube)\.(?:[cm]?[jt]s)$/u;
const forbiddenServerMarker = /(?:YOUTUBE_OAUTH_CLIENT_ID|YOUTUBE_REFRESH_TOKEN|REMOTION_BROWSER_EXECUTABLE|STUDIO_TTS_MODEL|oauth2\.googleapis\.com|upload\/youtube|moheng-virtual-host\.png)/u;
const maximumTotalBytes = 160 * 1024 * 1024;

if (!existsSync(standaloneRoot)) {
  throw new Error("Next standalone output is missing. Run `npm run build` first.");
}

for (const directory of forbiddenDirectories) {
  if (existsSync(join(standaloneRoot, directory))) {
    throw new Error(`Standalone output unexpectedly contains ${directory}/.`);
  }
}

const stack = [standaloneRoot];
const forbiddenFiles = [];
const forbiddenBundleMarkers = [];
let totalBytes = 0;
let fileCount = 0;
while (stack.length) {
  const directory = stack.pop();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      stack.push(path);
      continue;
    }
    const projectPath = relative(standaloneRoot, path).replaceAll("\\", "/");
    if (forbiddenFile.test(projectPath) || forbiddenWorkerSource.test(projectPath)) {
      forbiddenFiles.push(projectPath);
    }
    if (projectPath.startsWith(".next/server/") && projectPath.endsWith(".js")) {
      const marker = readFileSync(path, "utf8").match(forbiddenServerMarker)?.[0];
      if (marker) forbiddenBundleMarkers.push(`${projectPath} (${marker})`);
    }
    totalBytes += statSync(path).size;
    fileCount += 1;
  }
}

if (forbiddenFiles.length) {
  throw new Error(`Standalone output contains forbidden runtime files: ${forbiddenFiles.join(", ")}`);
}
if (forbiddenBundleMarkers.length) {
  throw new Error(
    `Standalone server bundles contain worker or OAuth code: ${forbiddenBundleMarkers.join(", ")}`,
  );
}
if (totalBytes > maximumTotalBytes) {
  throw new Error(
    `Standalone output is unexpectedly large: ${totalBytes} bytes (limit ${maximumTotalBytes}).`,
  );
}

console.log(JSON.stringify({
  status: "clean",
  fileCount,
  totalBytes,
  totalMiB: Number((totalBytes / 1024 / 1024).toFixed(2)),
}));
