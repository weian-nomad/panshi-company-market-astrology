import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

function vaultPath() {
  return resolve(process.env.NOMAD_KEY_VAULT?.trim() || join(homedir(), ".config", "nomad", "keys.env"));
}

function decodeValue(raw: string) {
  const value = raw.trim();
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll(`'"'"'`, "'");
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\t", "\t")
      .replaceAll('\\"', '"')
      .replaceAll("\\\\", "\\");
  }
  return value;
}

/**
 * Loads only explicitly requested names from the central key vault. The file
 * is parsed as inert text: no shell expansion, command substitution or output.
 */
export function loadVaultKeys(names: readonly string[]) {
  const wanted = new Set(names.filter((name) => !process.env[name]?.trim()));
  if (!wanted.size) return;

  let source: string;
  try {
    source = readFileSync(vaultPath(), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }

  for (const line of source.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || !wanted.has(match[1])) continue;
    const value = decodeValue(match[2]);
    if (value) process.env[match[1]] = value;
  }
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Atomically writes or removes one allowlisted-style key without evaluating the vault. */
export async function writeVaultKey(name: string, value: string | null) {
  if (!/^[A-Z][A-Z0-9_]*$/u.test(name)) throw new Error("Vault key name is invalid.");
  if (value !== null && /[\r\n\0]/u.test(value)) {
    throw new Error("Vault values must be single-line text.");
  }

  const path = vaultPath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  let existing = "";
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error("The key vault must not be a symbolic link.");
    if (!stats.isFile()) throw new Error("The key vault path is not a regular file.");
    existing = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (value === null) return;
  }

  const assignmentPattern = new RegExp(
    `^(?:export\\s+)?${name}\\s*=.*(?:\\r?\\n|$)`,
    "gmu",
  );
  const withoutAssignment = existing.replace(assignmentPattern, "");
  const next = value === null
    ? withoutAssignment
    : `${withoutAssignment}${withoutAssignment && !withoutAssignment.endsWith("\n") ? "\n" : ""}${name}=${shellQuote(value)}\n`;
  if (next === existing) {
    await chmod(path, 0o600);
    return;
  }

  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, next, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
