import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repoRoot, "scripts", "run-vitest-stable.mjs");

function dryRun(args) {
  const result = spawnSync(process.execPath, [script, ...args, "--dry-run"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return result;
}

function dryRunJson(args) {
  const result = dryRun(args);
  assert.equal(result.status, 0, `expected success for ${args.join(" ")}: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

const SHARD_COUNT = 3;

test("the general-server shards form a complete, non-overlapping partition", () => {
  const shards = Array.from({ length: SHARD_COUNT }, (_, index) =>
    dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", String(index), "--shard-count", String(SHARD_COUNT)]),
  );

  const total = shards[0].generalServerSuiteCount;
  assert.ok(total > 0, "expected a non-empty general-server suite set");

  const seen = new Set();
  let selectedTotal = 0;
  for (const shard of shards) {
    assert.equal(shard.generalServerSuiteCount, total, "suite count must be stable across shards");
    for (const file of shard.selectedGeneralServerSuites) {
      assert.ok(!seen.has(file), `suite assigned to more than one shard: ${file}`);
      seen.add(file);
      selectedTotal += 1;
    }
  }

  // Every suite runs exactly once: union covers the whole set with no overlap.
  assert.equal(selectedTotal, total, "every suite must be selected exactly once");
  assert.equal(seen.size, total, "union of shards must cover the whole suite set");
});

test("a route/authz suite never leaks into the general-server shards", () => {
  const shard = dryRunJson(["--mode", "general", "--group", "general-server", "--shard-index", "0", "--shard-count", SHARD_COUNT.toString()]);
  for (const file of shard.selectedGeneralServerSuites) {
    assert.ok(
      !/[^/]*(?:route|routes|authz)[^/]*\.test\.ts$/.test(file),
      `route/authz suite must stay in the serialized lane, not general-server: ${file}`,
    );
  }
});

test("the unsharded general-server group passes its suites to vitest positionally", () => {
  // Asserts the planned argv, not the file selection. The selection was never wrong —
  // `generalServerTestFiles` has always been correct — so a selection-only assertion cannot
  // see this bug. What broke was the argv: the unsharded branch excluded the serialized
  // suites with `--exclude`, which vitest ignores when invoked from the repo root with
  // `--project`, so the group collected all 405 server suites instead of 295 and every
  // serialized suite ran twice. PR CI always shards this group, so only release.yml and a
  // local `pnpm test` took the broken path.
  const run = dryRunJson(["--mode", "general", "--group", "general-server"]);

  assert.equal(run.plannedInvocations.length, 1, "expected exactly one vitest invocation");
  const [{ args }] = run.plannedInvocations;

  assert.ok(
    !args.includes("--exclude"),
    "must not rely on --exclude, which vitest ignores from the repo root with --project",
  );

  const positional = args.filter((arg) => arg.endsWith(".test.ts"));
  assert.deepEqual(
    positional,
    run.selectedGeneralServerSuites,
    "the argv must carry exactly the suites this group owns",
  );

  const serialized = new Set(run.selectedSerializedSuites);
  for (const file of positional) {
    assert.ok(!serialized.has(file), `serialized suite must not run here too: ${file}`);
  }
});

test("shard flags are rejected for the parallel workspace groups", () => {
  const result = dryRun(["--mode", "general", "--group", "general-workspaces-a", "--shard-index", "0", "--shard-count", "3"]);
  assert.notEqual(result.status, 0, "workspace groups must not accept shard flags");
});
