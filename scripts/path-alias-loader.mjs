const projectRoot = new URL("../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  let rewritten = specifier;
  if (specifier.startsWith("@/")) {
    rewritten = new URL(specifier.slice(2), projectRoot).href;
    // Next.js's bundler resolves extension-less specifiers (tsconfig
    // "moduleResolution: bundler"); plain Node ESM needs the real extension.
    if (!/\.[a-z]+$/i.test(rewritten)) rewritten += ".ts";
  }
  const result = await nextResolve(rewritten, context);
  // Next.js's bundler imports JSON without an import attribute; plain Node
  // ESM requires `with { type: "json" }` — inject it here instead of
  // touching the (bundler-only) source import.
  if (result.url.endsWith(".json") && result.importAttributes?.type !== "json") {
    return { ...result, importAttributes: { ...result.importAttributes, type: "json" } };
  }
  return result;
}
