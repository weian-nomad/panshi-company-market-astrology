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

function validateKeyName(name: string) {
  if (!/^[A-Z][A-Z0-9_]*$/u.test(name)) throw new Error("Vault key name is invalid.");
}

function assignedValues(source: string, name: string) {
  const pattern = new RegExp(
    `^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*)$`,
    "gmu",
  );
  return [...source.matchAll(pattern)].map((match) => decodeValue(match[1]));
}

/** Checks the effective stored value without returning or logging the secret. */
export async function vaultKeyMatches(name: string, expectedValue: string) {
  validateKeyName(name);
  const path = vaultPath();
  try {
    const stats = await lstat(path);
    if (stats.isSymbolicLink()) throw new Error("The key vault must not be a symbolic link.");
    if (!stats.isFile()) throw new Error("The key vault path is not a regular file.");
    const values = assignedValues(await readFile(path, "utf8"), name);
    return values.length > 0 && values.at(-1) === expectedValue;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

/** Atomically writes or removes one allowlisted-style key without evaluating the vault. */
export async function writeVaultKey(
  name: string,
  value: string | null,
  options: { requireExisting?: boolean; expectedValue?: string } = {},
) {
  validateKeyName(name);
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
    if (value === null && options.requireExisting) {
      throw new Error("The configured key vault does not contain the required key.");
    }
    if (value === null) {
      return { changed: false, keyPresentBefore: false, keyPresentAfter: false };
    }
  }

  const values = assignedValues(existing, name);
  const keyPresentBefore = values.length > 0;
  if (options.requireExisting && !keyPresentBefore) {
    throw new Error("The configured key vault does not contain the required key.");
  }
  if (options.expectedValue !== undefined && values.at(-1) !== options.expectedValue) {
    throw new Error("The configured key vault value does not match the active credential.");
  }
  const assignmentPattern = new RegExp(
    `^\\s*(?:export\\s+)?${name}\\s*=.*(?:\\r?\\n|$)`,
    "gmu",
  );
  const withoutAssignment = existing.replace(assignmentPattern, "");
  const next = value === null
    ? withoutAssignment
    : `${withoutAssignment}${withoutAssignment && !withoutAssignment.endsWith("\n") ? "\n" : ""}${name}=${shellQuote(value)}\n`;
  if (next === existing) {
    await chmod(path, 0o600);
    return { changed: false, keyPresentBefore, keyPresentAfter: value !== null };
  }

  const temporaryPath = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, next, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, path);
    await chmod(path, 0o600);
    return { changed: true, keyPresentBefore, keyPresentAfter: value !== null };
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}
