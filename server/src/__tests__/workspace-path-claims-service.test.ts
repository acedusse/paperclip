import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, afterEach, describe, expect, it } from "vitest";
import { createDb, companies, agents, projects, executionWorkspaces, heartbeatRuns, workspacePathClaims } from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { workspacePathClaimService } from "../services/workspace-path-claims.ts";

const support = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = support.supported ? describe : describe.skip;

if (!support.supported) {
  console.warn(
    `Skipping embedded Postgres workspace-path-claims tests on this host: ${support.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("workspacePathClaimService", () => {
  let db!: ReturnType<typeof createDb>;
  let svc!: ReturnType<typeof workspacePathClaimService>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-wspc-service-");
    db = createDb(tempDb.connectionString);
    svc = workspacePathClaimService(db);
  }, 20_000);

  afterEach(async () => {
    await db.delete(workspacePathClaims);
    await db.delete(heartbeatRuns);
    await db.delete(executionWorkspaces);
    await db.delete(projects);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => { await tempDb?.cleanup(); });

  async function seed() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const projectId = randomUUID();
    const wsA = randomUUID();
    await db.insert(companies).values({ id: companyId, name: "P", issuePrefix: "WSPC", requireBoardApprovalForNewAgents: false });
    await db.insert(agents).values({ id: agentId, companyId, name: "A" });
    await db.insert(projects).values({ id: projectId, companyId, name: "Path claims project" });
    await db.insert(executionWorkspaces).values({
      id: wsA, companyId, projectId, mode: "shared_workspace", strategyType: "shared", name: "WS A", status: "active", cwd: "/tmp/a",
    });
    const runA = randomUUID();
    const runB = randomUUID();
    await db.insert(heartbeatRuns).values([
      { id: runA, companyId, agentId, status: "running" },
      { id: runB, companyId, agentId, status: "running" },
    ]);
    return { companyId, agentId, wsA, runA, runB };
  }

  it("acquires an active claim with a normalized path and TTL expiry", async () => {
    const { companyId, agentId, wsA, runA } = await seed();
    const now = new Date("2026-07-13T00:00:00.000Z");
    const claim = await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runA, agentId, path: "/src/pay/", ttlMs: 1000, now });
    expect(claim.status).toBe("active");
    expect(claim.path).toBe("src/pay");
    expect(claim.expiresAt?.getTime()).toBe(now.getTime() + 1000);
  });

  it("lists active claims on a workspace, excluding a run", async () => {
    const { companyId, agentId, wsA, runA, runB } = await seed();
    await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runA, agentId, path: "src/pay" });
    await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runB, agentId, path: "docs" });
    const active = await svc.listActiveClaimsOnWorkspace(wsA, runA);
    expect(active.map((c) => c.path)).toEqual(["docs"]);
  });

  it("releases only the target run's active claims", async () => {
    const { companyId, agentId, wsA, runA, runB } = await seed();
    await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runA, agentId, path: "src/pay" });
    await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runB, agentId, path: "docs" });
    expect(await svc.releaseClaimsForRun(runA)).toBe(1);
    const active = await svc.listActiveClaimsOnWorkspace(wsA);
    expect(active.map((c) => c.path)).toEqual(["docs"]);
  });

  it("finds and expires only past-TTL active claims", async () => {
    const { companyId, agentId, wsA, runA } = await seed();
    const past = new Date("2026-07-13T00:00:00.000Z");
    const c = await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runA, agentId, path: "src/pay", ttlMs: 1000, now: past });
    const later = new Date(past.getTime() + 5000);
    const expired = await svc.findExpiredClaims(later);
    expect(expired.map((e) => e.id)).toEqual([c.id]);
    await svc.expireClaim(c.id, later);
    expect(await svc.listActiveClaimsOnWorkspace(wsA)).toEqual([]);
  });

  it("counts active-within-TTL claims per workspace, excluding released/expired/other", async () => {
    const { companyId, agentId, wsA, runA, runB } = await seed();
    const now = new Date("2026-07-13T00:00:00.000Z");
    const future = { ttlMs: 60_000, now }; // expiresAt = now + 60s
    // Two active claims on wsA from two different runs.
    await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runA, agentId, path: "src/pay", ...future });
    await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runB, agentId, path: "src/ui", ...future });
    // A released claim must not count.
    const released = await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runA, agentId, path: "src/old", ...future });
    await svc.releaseClaimsForRun(runA); // flips runA's active claims → released
    // A claim whose TTL already lapsed relative to `now` must not count.
    await svc.acquireClaim({ companyId, executionWorkspaceId: wsA, heartbeatRunId: runB, agentId, path: "src/stale", ttlMs: 1, now: new Date(now.getTime() - 10_000) });

    const counts = await svc.activeClaimCountsForWorkspaces([wsA], now);
    // runA's two claims (src/pay, src/old) were released; only runB's src/ui remains active-within-TTL.
    expect(counts.get(wsA)).toBe(1);
    expect(released.status).toBe("active"); // acquire returns active before release
  });

  it("returns an empty map without a query for empty input", async () => {
    const counts = await svc.activeClaimCountsForWorkspaces([], new Date());
    expect(counts.size).toBe(0);
  });
});
