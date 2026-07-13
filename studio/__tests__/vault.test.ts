import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadVaultKeys, vaultKeyMatches, writeVaultKey } from "@/studio/vault";

test("vault parser loads only requested keys without shell evaluation", () => {
  const root = mkdtempSync(join(tmpdir(), "panshi-vault-"));
  const path = join(root, "keys.env");
  const originalPath = process.env.NOMAD_KEY_VAULT;
  const originalAllowed = process.env.TEST_ALLOWED_KEY;
  const originalBlocked = process.env.TEST_BLOCKED_KEY;
  try {
    writeFileSync(path, [
      "TEST_ALLOWED_KEY='value with spaces'",
      "TEST_BLOCKED_KEY=do-not-load",
      "BROKEN_VALUE=$(touch should-never-run)",
      "",
    ].join("\n"), { mode: 0o600 });
    chmodSync(path, 0o600);
    process.env.NOMAD_KEY_VAULT = path;
    delete process.env.TEST_ALLOWED_KEY;
    delete process.env.TEST_BLOCKED_KEY;

    loadVaultKeys(["TEST_ALLOWED_KEY"]);

    assert.equal(process.env.TEST_ALLOWED_KEY, "value with spaces");
    assert.equal(process.env.TEST_BLOCKED_KEY, undefined);
    assert.match(readFileSync(path, "utf8"), /\$\(touch should-never-run\)/);
  } finally {
    if (originalPath === undefined) delete process.env.NOMAD_KEY_VAULT;
    else process.env.NOMAD_KEY_VAULT = originalPath;
    if (originalAllowed === undefined) delete process.env.TEST_ALLOWED_KEY;
    else process.env.TEST_ALLOWED_KEY = originalAllowed;
    if (originalBlocked === undefined) delete process.env.TEST_BLOCKED_KEY;
    else process.env.TEST_BLOCKED_KEY = originalBlocked;
    rmSync(root, { recursive: true, force: true });
  }
});

test("vault writer atomically updates and removes one key", async () => {
  const root = mkdtempSync(join(tmpdir(), "panshi-vault-write-"));
  const path = join(root, "keys.env");
  const originalPath = process.env.NOMAD_KEY_VAULT;
  const originalValue = process.env.TEST_WRITE_KEY;
  try {
    writeFileSync(path, "OTHER_KEY='retained'\nTEST_WRITE_KEY='old'\n", { mode: 0o600 });
    process.env.NOMAD_KEY_VAULT = path;
    const update = await writeVaultKey("TEST_WRITE_KEY", "new value");
    assert.deepEqual(update, {
      changed: true,
      keyPresentBefore: true,
      keyPresentAfter: true,
    });
    delete process.env.TEST_WRITE_KEY;
    loadVaultKeys(["TEST_WRITE_KEY"]);
    assert.equal(process.env.TEST_WRITE_KEY, "new value");
    assert.equal(await vaultKeyMatches("TEST_WRITE_KEY", "new value"), true);
    assert.match(readFileSync(path, "utf8"), /OTHER_KEY='retained'/u);

    await assert.rejects(
      writeVaultKey("TEST_WRITE_KEY", null, {
        requireExisting: true,
        expectedValue: "wrong value",
      }),
      /does not match/,
    );
    assert.equal(await vaultKeyMatches("TEST_WRITE_KEY", "new value"), true);

    const removal = await writeVaultKey("TEST_WRITE_KEY", null, {
      requireExisting: true,
      expectedValue: "new value",
    });
    assert.deepEqual(removal, {
      changed: true,
      keyPresentBefore: true,
      keyPresentAfter: false,
    });
    assert.doesNotMatch(readFileSync(path, "utf8"), /TEST_WRITE_KEY/u);
    await assert.rejects(
      writeVaultKey("TEST_WRITE_KEY", null, { requireExisting: true }),
      /does not contain/,
    );
    assert.equal(statSync(path).mode & 0o777, 0o600);
  } finally {
    if (originalPath === undefined) delete process.env.NOMAD_KEY_VAULT;
    else process.env.NOMAD_KEY_VAULT = originalPath;
    if (originalValue === undefined) delete process.env.TEST_WRITE_KEY;
    else process.env.TEST_WRITE_KEY = originalValue;
    rmSync(root, { recursive: true, force: true });
  }
});
