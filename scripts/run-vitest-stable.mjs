#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = process.cwd();
const serverRoot = path.join(repoRoot, "server");
const serverSrcDir = path.join(repoRoot, "server", "src");
const serverTestsDir = path.join(repoRoot, "server", "src", "__tests__");
const nonServerProjects = [
  "@paperclipai/shared",
  "@paperclipai/skills-catalog",
  "@paperclipai/db",
  "@paperclipai/adapter-utils",
  "@paperclipai/adapter-acpx-local",
  "@paperclipai/adapter-codex-local",
  "@paperclipai/adapter-opencode-local",
  "@paperclipai/plugin-sdk",
  "@paperclipai/create-paperclip-plugin",
  "@paperclipai/ui",
  "paperclipai",
];
const routeTestPattern = /[^/]*(?:route|routes|authz)[^/]*\.test\.ts$/;
const additionalSerializedServerTests = new Set([
  "server/src/__tests__/approval-routes-idempotency.test.ts",
  "server/src/__tests__/assets.test.ts",
  "server/src/__tests__/authz-company-access.test.ts",
  "server/src/__tests__/companies-route-path-guard.test.ts",
  "server/src/__tests__/company-portability.test.ts",
  "server/src/__tests__/costs-service.test.ts",
  "server/src/__tests__/express5-auth-wildcard.test.ts",
  "server/src/__tests__/health-dev-server-token.test.ts",
  "server/src/__tests__/health.test.ts",
  "server/src/__tests__/heartbeat-dependency-scheduling.test.ts",
  "server/src/__tests__/heartbeat-issue-liveness-escalation.test.ts",
  "server/src/__tests__/heartbeat-process-recovery.test.ts",
  "server/src/__tests__/invite-accept-existing-member.test.ts",
  "server/src/__tests__/invite-accept-gateway-defaults.test.ts",
  "server/src/__tests__/invite-accept-replay.test.ts",
  "server/src/__tests__/invite-expiry.test.ts",
  "server/src/__tests__/invite-join-manager.test.ts",
  "server/src/__tests__/invite-onboarding-text.test.ts",
  "server/src/__tests__/issues-checkout-wakeup.test.ts",
  "server/src/__tests__/issues-service.test.ts",
  "server/src/__tests__/opencode-local-adapter-environment.test.ts",
  "server/src/__tests__/project-routes-env.test.ts",
  "server/src/__tests__/redaction.test.ts",
  "server/src/__tests__/routines-e2e.test.ts",
  "server/src/__tests__/stakeholder-share-service.test.ts",
]);
let invocationIndex = 0;
const serializedModeName = "serialized";
const generalModeName = "general";
const allModeName = "all";
const generalServerGroupName = "general-server";
const generalWorkspacesAGroupName = "general-workspaces-a";
const generalWorkspacesBGroupName = "general-workspaces-b";
const generalWorkspacesAProjects = ["@paperclipai/ui", "paperclipai"];
const generalWorkspacesBProjects = nonServerProjects.filter((project) => !generalWorkspacesAProjects.includes(project));
const generalGroupNames = [generalServerGroupName, generalWorkspacesAGroupName, generalWorkspacesBGroupName];
const serializedServerVitestArgs = [
  "--no-file-parallelism",
  "--maxWorkers=1",
];

function walk(dir) {
  const entries = readdirSync(dir);
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry);
    const stats = statSync(absolute);
    if (stats.isDirectory()) {
      files.push(...walk(absolute));
    } else if (stats.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function toRepoPath(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function toServerPath(file) {
  return path.relative(serverRoot, file).split(path.sep).join("/");
}

function isRouteOrAuthzTest(file) {
  if (routeTestPattern.test(file)) {
    return true;
  }

  return additionalSerializedServerTests.has(file);
}

function fail(message) {
  console.error(`[test:run] ${message}`);
  process.exit(1);
}

function readOptionValue(argv, index, argName) {
  const value = argv[index + 1];
  if (value === undefined) {
    fail(`Missing value for ${argName}`);
  }

  return value;
}

function parseNonNegativeInteger(value, argName) {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isInteger(parsed) || parsed < 0) {
    fail(`${argName} must be a non-negative integer. Received "${value}".`);
  }

  return parsed;
}

function parsePositiveInteger(value, argName) {
  const parsed = Number(value);
  if (value.trim() === "" || !Number.isInteger(parsed) || parsed < 1) {
    fail(`${argName} must be a positive integer. Received "${value}".`);
  }

  return parsed;
}

function parseCliOptions(argv) {
  let mode = allModeName;
  let shardIndex = null;
  let shardCount = null;
  let group = null;
  let dryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--") {
      continue;
    }

    if (arg === "--mode") {
      mode = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
      continue;
    }

    if (arg === "--shard-index") {
      shardIndex = parseNonNegativeInteger(readOptionValue(argv, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--shard-index=")) {
      shardIndex = parseNonNegativeInteger(arg.slice("--shard-index=".length), "--shard-index");
      continue;
    }

    if (arg === "--shard-count") {
      shardCount = parsePositiveInteger(readOptionValue(argv, index, arg), arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--shard-count=")) {
      shardCount = parsePositiveInteger(arg.slice("--shard-count=".length), "--shard-count");
      continue;
    }

    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }

    if (arg === "--group") {
      group = readOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--group=")) {
      group = arg.slice("--group=".length);
      continue;
    }

    fail(`Unknown argument "${arg}".`);
  }

  if (!new Set([allModeName, generalModeName, serializedModeName]).has(mode)) {
    fail(`Unknown mode "${mode}". Expected one of: ${allModeName}, ${generalModeName}, ${serializedModeName}.`);
  }

  if ((shardIndex === null) !== (shardCount === null)) {
    fail("--shard-index and --shard-count must be provided together.");
  }

  const shardAllowed =
    mode === serializedModeName ||
    (mode === generalModeName && group === generalServerGroupName);
  if (!shardAllowed && shardIndex !== null) {
    fail(
      "--shard-index/--shard-count are only valid with --mode serialized or --mode general --group general-server.",
    );
  }

  if (group !== null && mode !== generalModeName) {
    fail("--group is only valid with --mode general.");
  }

  if (group !== null && !generalGroupNames.includes(group)) {
    fail(`Unknown group "${group}". Expected one of: ${generalGroupNames.join(", ")}.`);
  }

  if (shardIndex !== null) {
    if (shardIndex >= shardCount) {
      fail(`--shard-index must be less than --shard-count. Received ${shardIndex} of ${shardCount}.`);
    }
  }

  if (mode === serializedModeName) {
    return {
      mode,
      shardIndex: shardIndex ?? 0,
      shardCount: shardCount ?? 1,
      group: null,
      dryRun,
    };
  }

  return {
    mode,
    shardIndex,
    shardCount,
    group,
    dryRun,
  };
}

function selectSerializedSuites(routeTests, shardIndex, shardCount) {
  return routeTests.filter((_, index) => index % shardCount === shardIndex);
}

// Populated instead of spawning when --dry-run is set, so the planned vitest argv is
// inspectable. The file *selection* was never the bug — `generalServerTestFiles` was always
// correct; what broke was the argv built from it. A dry run that only reports the selection
// cannot see that class of defect at all.
const plannedInvocations = [];
let dryRunRequested = false;

// Progress chatter must not land on stdout during a dry run: the JSON report is the only
// thing there, so consumers can parse it.
function logProgress(message) {
  if (dryRunRequested) {
    return;
  }
  console.log(message);
}

function runVitest(args, label) {
  if (dryRunRequested) {
    plannedInvocations.push({ label, args });
    return;
  }
  console.log(`\n[test:run] ${label}`);
  invocationIndex += 1;
  const tempRootParent = process.platform === "win32" ? os.tmpdir() : "/tmp";
  const testRoot = mkdtempSync(path.join(tempRootParent, `pcvt-${process.pid}-${invocationIndex}-`));
  // Keep per-run paths compact so Unix socket fixtures stay under macOS path limits.
  const env = {
    ...process.env,
    NODE_ENV: "test",
    PAPERCLIP_HOME: path.join(testRoot, "h"),
    PAPERCLIP_INSTANCE_ID: `vt-${process.pid}-${invocationIndex}`,
    TMPDIR: path.join(testRoot, "t"),
  };
  mkdirSync(env.PAPERCLIP_HOME, { recursive: true });
  mkdirSync(env.TMPDIR, { recursive: true });
  const result = spawnSync("pnpm", ["exec", "vitest", "run", ...args], {
    cwd: repoRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`[test:run] Failed to start Vitest: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function runGeneralSuites(routeTests) {
  for (const groupName of generalGroupNames) {
    runGeneralGroup(routeTests, groupName);
  }
}

function runProjectGroup(projects, groupName) {
  for (const project of projects) {
    runVitest(["--project", project], `${groupName} project ${project}`);
  }
}

function runGeneralGroup(routeTests, groupName, shardIndex = null, shardCount = null) {
  if (groupName === generalServerGroupName) {
    if (shardCount !== null && shardCount > 1) {
      const shardFiles = generalServerTestFiles.filter(
        (_, index) => index % shardCount === shardIndex,
      );
      logProgress(
        `\n[test:run] general-server shard ${shardIndex + 1}/${shardCount} running ${shardFiles.length} of ${generalServerTestFiles.length} suites`,
      );
      if (shardFiles.length === 0) {
        return;
      }

      runVitest(
        [
          "--project",
          "@paperclipai/server",
          ...serializedServerVitestArgs,
          ...shardFiles,
        ],
        `${groupName} shard ${shardIndex + 1}/${shardCount}`,
      );
      return;
    }

    // Pass the files this group owns positionally rather than excluding the serialized
    // ones. `--exclude` is silently ignored when vitest is invoked from the repo root with
    // `--project` — verified directly: the same pattern filters correctly when run from
    // `server/`, and does nothing from the root, in every path form. The result was that
    // this group collected all 406 server test files instead of 296, so every serialized
    // suite ran twice per full run: once here, once in its own shard. Those are the
    // embedded-Postgres suites, the slowest in the repo.
    //
    // Positional filtering is what the sharded branch above and runSerializedSuites already
    // use, and both work, so this makes the three paths consistent.
    if (generalServerTestFiles.length === 0) {
      return;
    }
    runVitest(
      [
        "--project",
        "@paperclipai/server",
        ...serializedServerVitestArgs,
        ...generalServerTestFiles,
      ],
      `${groupName} ${generalServerTestFiles.length} server suites (${routeTests.length} serialized suites run separately)`,
    );
    return;
  }

  if (groupName === generalWorkspacesAGroupName) {
    runProjectGroup(generalWorkspacesAProjects, groupName);
    return;
  }

  if (groupName === generalWorkspacesBGroupName) {
    runProjectGroup(generalWorkspacesBProjects, groupName);
    return;
  }

  fail(`Unknown group "${groupName}".`);
}

function runSerializedSuites(routeTests, shardIndex, shardCount) {
  const shardTests = selectSerializedSuites(routeTests, shardIndex, shardCount);
  logProgress(
    `\n[test:run] serialized shard ${shardIndex + 1}/${shardCount} running ${shardTests.length} of ${routeTests.length} suites`,
  );

  for (const routeTest of shardTests) {
    runVitest(
      [
        "--project",
        "@paperclipai/server",
        routeTest.repoPath,
        "--pool=forks",
        "--isolate",
      ],
      routeTest.repoPath,
    );
  }
}

const routeTests = walk(serverTestsDir)
  .filter((file) => isRouteOrAuthzTest(toRepoPath(file)))
  .map((file) => ({
    repoPath: toRepoPath(file),
    serverPath: toServerPath(file),
  }))
  .sort((a, b) => a.repoPath.localeCompare(b.repoPath));

// Every server test file that the general-server group is responsible for,
// i.e. the whole server project minus the route/authz suites that run in the
// dedicated serialized shards. Sharding this list across runners is what keeps
// the general-server lane from becoming the PR critical path: the server vitest
// config pins maxWorkers to 1, so the only way to parallelize is across jobs.
const generalServerTestFiles = walk(serverSrcDir)
  .map((file) => toRepoPath(file))
  .filter((repoPath) => repoPath.endsWith(".test.ts"))
  .filter((repoPath) => !isRouteOrAuthzTest(repoPath))
  .sort((a, b) => a.localeCompare(b));

const options = parseCliOptions(process.argv.slice(2));
dryRunRequested = options.dryRun;

// Dispatch first, even for a dry run: runVitest records the planned argv instead of
// spawning, so what gets reported is produced by the code path that would really run.
if (options.mode === generalModeName || options.mode === allModeName) {
  if (options.group) {
    runGeneralGroup(routeTests, options.group, options.shardIndex, options.shardCount);
  } else {
    runGeneralSuites(routeTests);
  }
}

if (options.mode === serializedModeName || options.mode === allModeName) {
  runSerializedSuites(routeTests, options.shardIndex ?? 0, options.shardCount ?? 1);
}

if (options.dryRun) {
  const serializedSuites =
    options.mode === serializedModeName
      ? selectSerializedSuites(routeTests, options.shardIndex, options.shardCount)
      : routeTests;
  console.log(
    JSON.stringify(
      {
        mode: options.mode,
        shardIndex: options.shardIndex,
        shardCount: options.shardCount,
        group: options.group,
        availableGeneralGroups: generalGroupNames,
        serializedSuiteCount: routeTests.length,
        selectedSerializedSuites: serializedSuites.map((routeTest) => routeTest.repoPath),
        generalServerSuiteCount: generalServerTestFiles.length,
        // Reported for the unsharded run too, not just shards. The unsharded path is the
        // one release.yml and a local `pnpm test` take, and it was the one that silently
        // collected every server suite; leaving it unreportable is what kept it untested.
        selectedGeneralServerSuites:
          options.mode === generalModeName && options.group === generalServerGroupName
            ? options.shardCount !== null
              ? generalServerTestFiles.filter(
                  (_, index) => index % options.shardCount === options.shardIndex,
                )
              : generalServerTestFiles
            : null,
        plannedInvocations,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}
