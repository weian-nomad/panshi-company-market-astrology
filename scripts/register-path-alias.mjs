/**
 * Standalone Node scripts (backfill/update) import shared lib modules that
 * use the "@/" path alias — resolved by Next.js's bundler at build time, but
 * meaningless to plain Node ESM at script-run time. This registers a tiny
 * resolve hook that rewrites "@/x" to the project-root-relative file "x",
 * so scripts can `node --import ./scripts/register-path-alias.mjs script.ts`.
 */
import { register } from "node:module";

register("./path-alias-loader.mjs", import.meta.url);
