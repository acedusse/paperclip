/**
 * FILE: server/src/__tests__/fallback-chain.test.ts
 * ABOUT: fallback-chain.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - fallback-chain.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: fallback-chain.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/fallback-chain.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  FALLBACK_THRESHOLD_MS,
  MAX_FALLBACK_CHAIN_LENGTH,
  MAX_FALLBACK_HOPS,
  buildFallbackContext,
  classifyFallbackTrigger,
  parseFallbackChain,
  readFallbackHop,
  readFallbackState,
  resolveEffectiveAdapter,
  selectFallbackTarget,
} from "../services/fallback-chain.js";

const NOW = new Date("2026-08-01T12:00:00.000Z");
const KNOWN = new Set(["codex_local", "opencode_local", "pi_local", "claude_local"]);

function at(offsetMs: number): Date {
  return new Date(NOW.getTime() + offsetMs);
}

describe("classifyFallbackTrigger — quota vs blip", () => {
  it("falls back when the provider asks us to wait longer than the threshold", () => {
    expect(
      classifyFallbackTrigger({
        errorFamily: "transient_upstream",
        retryNotBefore: at(FALLBACK_THRESHOLD_MS + 1),
        now: NOW,
      }),
    ).toBe("fall_back");
  });

  it("retries the same provider for a short wait — the ladder gets there sooner anyway", () => {
    expect(
      classifyFallbackTrigger({
        errorFamily: "transient_upstream",
        retryNotBefore: at(30_000),
        now: NOW,
      }),
    ).toBe("retry_same");
  });

  it("treats exactly the threshold as not yet worth a hop", () => {
    // Boundary is deliberate: > threshold, not >=.
    expect(
      classifyFallbackTrigger({
        errorFamily: "transient_upstream",
        retryNotBefore: at(FALLBACK_THRESHOLD_MS),
        now: NOW,
      }),
    ).toBe("retry_same");
  });

  it("falls back one millisecond past the threshold", () => {
    expect(
      classifyFallbackTrigger({
        errorFamily: "transient_upstream",
        retryNotBefore: at(FALLBACK_THRESHOLD_MS + 1),
        now: NOW,
      }),
    ).toBe("fall_back");
  });

  it("treats a retryNotBefore in the past as a blip", () => {
    expect(
      classifyFallbackTrigger({
        errorFamily: "transient_upstream",
        retryNotBefore: at(-60 * 60 * 1000),
        now: NOW,
      }),
    ).toBe("retry_same");
  });

  it("accepts retryNotBefore as an ISO string", () => {
    expect(
      classifyFallbackTrigger({
        errorFamily: "transient_upstream",
        retryNotBefore: at(FALLBACK_THRESHOLD_MS + 60_000).toISOString(),
        now: NOW,
      }),
    ).toBe("fall_back");
  });

  it("falls back on an explicit quota error code regardless of retryNotBefore", () => {
    expect(
      classifyFallbackTrigger({ errorCode: "codex_quota_exhausted", now: NOW }),
    ).toBe("fall_back");
    expect(
      classifyFallbackTrigger({ errorCode: "anthropic_rate_limited", now: NOW }),
    ).toBe("fall_back");
  });
});

describe("classifyFallbackTrigger — non-retryable", () => {
  for (const errorCode of [
    "agent_not_invokable",
    "agent_not_found",
    "budget_blocked",
    "budget_exhausted",
    "issue_paused",
    "issue_dependencies_blocked",
  ]) {
    it(`does not retry or fall back on ${errorCode}`, () => {
      expect(classifyFallbackTrigger({ errorCode, now: NOW })).toBe("do_not_retry");
    });
  }

  it("does not fall back on a non-retryable code even with a long retryNotBefore", () => {
    // A bad credential is not fixed by waiting, and not fixed by a different provider
    // if the chain shares the same broken config.
    expect(
      classifyFallbackTrigger({
        errorCode: "budget_exhausted",
        retryNotBefore: at(60 * 60 * 1000),
        now: NOW,
      }),
    ).toBe("do_not_retry");
  });
});

describe("classifyFallbackTrigger — fail-safe direction", () => {
  it("defaults to retry_same for unrecognised input, preserving today's behaviour", () => {
    expect(classifyFallbackTrigger({ now: NOW })).toBe("retry_same");
    expect(classifyFallbackTrigger({ errorCode: "who_knows", now: NOW })).toBe("retry_same");
    expect(classifyFallbackTrigger({ errorFamily: "model_refusal", now: NOW })).toBe("retry_same");
  });

  it("is total for malformed retryNotBefore rather than throwing in the run path", () => {
    for (const bad of ["not a date", "", "   "]) {
      expect(
        classifyFallbackTrigger({ errorFamily: "transient_upstream", retryNotBefore: bad, now: NOW }),
      ).toBe("retry_same");
    }
  });
});

describe("parseFallbackChain", () => {
  const opts = { knownAdapterTypes: KNOWN };

  it("parses a valid chain", () => {
    expect(
      parseFallbackChain(
        {
          fallbackChain: [
            { adapterType: "opencode_local", model: "cheap-model" },
            { adapterType: "pi_local" },
          ],
        },
        opts,
      ),
    ).toEqual([
      { adapterType: "opencode_local", model: "cheap-model" },
      { adapterType: "pi_local", model: null },
    ]);
  });

  it("returns an empty chain when absent — the default is current behaviour", () => {
    expect(parseFallbackChain({}, opts)).toEqual([]);
    expect(parseFallbackChain(null, opts)).toEqual([]);
    expect(parseFallbackChain(undefined, opts)).toEqual([]);
  });

  it("drops unknown adapter types instead of failing the agent", () => {
    expect(
      parseFallbackChain(
        { fallbackChain: [{ adapterType: "nope_local" }, { adapterType: "pi_local" }] },
        opts,
      ),
    ).toEqual([{ adapterType: "pi_local", model: null }]);
  });

  it("collapses consecutive duplicates, which would burn a hop for nothing", () => {
    expect(
      parseFallbackChain(
        {
          fallbackChain: [
            { adapterType: "pi_local" },
            { adapterType: "pi_local" },
            { adapterType: "codex_local" },
          ],
        },
        opts,
      ),
    ).toEqual([
      { adapterType: "pi_local", model: null },
      { adapterType: "codex_local", model: null },
    ]);
  });

  it("keeps a repeated adapter when the model differs", () => {
    const chain = parseFallbackChain(
      {
        fallbackChain: [
          { adapterType: "codex_local", model: "gpt-5" },
          { adapterType: "codex_local", model: "gpt-5-mini" },
        ],
      },
      opts,
    );
    expect(chain).toHaveLength(2);
  });

  it("caps the chain length", () => {
    const chain = parseFallbackChain(
      {
        fallbackChain: Array.from({ length: 20 }, (_, i) => ({
          adapterType: "codex_local",
          model: `m${i}`,
        })),
      },
      opts,
    );
    expect(chain).toHaveLength(MAX_FALLBACK_CHAIN_LENGTH);
  });

  it("is total for junk input", () => {
    for (const junk of [
      { fallbackChain: "nope" },
      { fallbackChain: 42 },
      { fallbackChain: [1, 2, 3] },
      { fallbackChain: [null, undefined] },
      { fallbackChain: [{ noAdapterType: true }] },
      { fallbackChain: {} },
    ]) {
      expect(parseFallbackChain(junk, opts)).toEqual([]);
    }
  });
});

describe("selectFallbackTarget", () => {
  const chain = [
    { adapterType: "opencode_local", model: "cheap" },
    { adapterType: "pi_local", model: null },
  ];

  it("selects the first entry from the primary", () => {
    expect(
      selectFallbackTarget({ chain, currentHop: 0, currentAdapterType: "codex_local" }),
    ).toEqual({
      target: { adapterType: "opencode_local", model: "cheap" },
      nextHop: 1,
      clearSession: true,
    });
  });

  it("advances along the chain", () => {
    expect(
      selectFallbackTarget({ chain, currentHop: 1, currentAdapterType: "opencode_local" }),
    ).toEqual({
      target: { adapterType: "pi_local", model: null },
      nextHop: 2,
      clearSession: true,
    });
  });

  it("returns null when the chain is spent, so the caller degrades to the ladder", () => {
    expect(
      selectFallbackTarget({ chain, currentHop: 2, currentAdapterType: "pi_local" }),
    ).toBeNull();
  });

  it("returns null for an empty chain", () => {
    expect(
      selectFallbackTarget({ chain: [], currentHop: 0, currentAdapterType: "codex_local" }),
    ).toBeNull();
  });

  it("enforces the hop cap even if the chain is longer", () => {
    const long = Array.from({ length: MAX_FALLBACK_CHAIN_LENGTH }, (_, i) => ({
      adapterType: "codex_local",
      model: `m${i}`,
    }));
    expect(
      selectFallbackTarget({
        chain: long,
        currentHop: MAX_FALLBACK_HOPS,
        currentAdapterType: "codex_local",
      }),
    ).toBeNull();
  });

  it("preserves the session when only the model changes", () => {
    const sameAdapter = [{ adapterType: "codex_local", model: "gpt-5-mini" }];
    expect(
      selectFallbackTarget({
        chain: sameAdapter,
        currentHop: 0,
        currentAdapterType: "codex_local",
      })?.clearSession,
    ).toBe(false);
  });

  it("clears the session when the adapter changes, because session ids are not portable", () => {
    expect(
      selectFallbackTarget({ chain, currentHop: 0, currentAdapterType: "codex_local" })
        ?.clearSession,
    ).toBe(true);
  });

  it("is total for a negative or absurd hop", () => {
    expect(
      selectFallbackTarget({ chain, currentHop: -5, currentAdapterType: "codex_local" }),
    ).toEqual({
      target: { adapterType: "opencode_local", model: "cheap" },
      nextHop: 1,
      clearSession: true,
    });
    expect(
      selectFallbackTarget({ chain, currentHop: 9999, currentAdapterType: "pi_local" }),
    ).toBeNull();
  });
});

describe("buildFallbackContext / readFallbackState round trip", () => {
  const selection = {
    target: { adapterType: "opencode_local", model: "cheap" },
    nextHop: 1,
    clearSession: true,
  };

  it("persists the resolved target, not just an index", () => {
    expect(buildFallbackContext(selection)).toEqual({
      fallbackHop: 1,
      fallbackAdapterType: "opencode_local",
      fallbackModel: "cheap",
    });
  });

  it("round trips", () => {
    expect(readFallbackState(buildFallbackContext(selection))).toEqual({
      hop: 1,
      adapterType: "opencode_local",
      model: "cheap",
    });
  });

  it("returns null on the primary adapter", () => {
    expect(readFallbackState({})).toBeNull();
    expect(readFallbackState(null)).toBeNull();
    expect(readFallbackState({ fallbackHop: 0 })).toBeNull();
  });

  it("falls safe to the primary when a hop has no recorded target", () => {
    // Rather than guessing an adapter by indexing a chain that may have changed.
    expect(readFallbackState({ fallbackHop: 2 })).toBeNull();
  });
});

describe("resolveEffectiveAdapter", () => {
  const adapterConfig = {
    model: "gpt-5",
    fallbackChain: [
      { adapterType: "opencode_local", model: "cheap" },
      { adapterType: "pi_local" },
    ],
  };

  it("returns the primary unchanged with no fallback state — today's behaviour, bit for bit", () => {
    const resolved = resolveEffectiveAdapter({
      adapterType: "codex_local",
      adapterConfig,
      fallbackState: null,
    });
    expect(resolved.adapterType).toBe("codex_local");
    expect(resolved.adapterConfig).toBe(adapterConfig);
    expect(resolved.isFallback).toBe(false);
    expect(resolved.hop).toBe(0);
  });

  it("resolves the persisted target", () => {
    const resolved = resolveEffectiveAdapter({
      adapterType: "codex_local",
      adapterConfig,
      fallbackState: { hop: 1, adapterType: "opencode_local", model: "cheap" },
    });
    expect(resolved.adapterType).toBe("opencode_local");
    expect(resolved.adapterConfig.model).toBe("cheap");
    expect(resolved.isFallback).toBe(true);
    expect(resolved.hop).toBe(1);
  });

  it("keeps the primary model when the target does not name one", () => {
    const resolved = resolveEffectiveAdapter({
      adapterType: "codex_local",
      adapterConfig,
      fallbackState: { hop: 2, adapterType: "pi_local", model: null },
    });
    expect(resolved.adapterType).toBe("pi_local");
    expect(resolved.adapterConfig.model).toBe("gpt-5");
  });

  it("does not carry the chain into the effective config", () => {
    // The effective agent must not be able to fall back off its own fallback.
    const resolved = resolveEffectiveAdapter({
      adapterType: "codex_local",
      adapterConfig,
      fallbackState: { hop: 1, adapterType: "opencode_local", model: "cheap" },
    });
    expect(resolved.adapterConfig.fallbackChain).toBeUndefined();
  });

  it("is immune to the chain being edited between the failure and the retry", () => {
    // The regression this design exists to prevent: an index into adapterConfig would
    // resolve to a different adapter than the one selected once the operator reorders
    // or filters the chain. The persisted target does not move.
    const selection = selectFallbackTarget({
      chain: parseFallbackChain(adapterConfig, { knownAdapterTypes: KNOWN }),
      currentHop: 0,
      currentAdapterType: "codex_local",
    })!;
    const persisted = buildFallbackContext(selection);

    const editedConfig = {
      model: "gpt-5",
      fallbackChain: [{ adapterType: "claude_local", model: "reordered" }],
    };

    const resolved = resolveEffectiveAdapter({
      adapterType: "codex_local",
      adapterConfig: editedConfig,
      fallbackState: readFallbackState(persisted),
    });
    expect(resolved.adapterType).toBe("opencode_local");
  });

  it("does not mutate the input config", () => {
    const original = JSON.parse(JSON.stringify(adapterConfig));
    resolveEffectiveAdapter({
      adapterType: "codex_local",
      adapterConfig,
      fallbackState: { hop: 1, adapterType: "opencode_local", model: "cheap" },
    });
    expect(adapterConfig).toEqual(original);
  });
});

describe("readFallbackHop", () => {
  it("reads a hop from a context snapshot", () => {
    expect(readFallbackHop({ fallbackHop: 2 })).toBe(2);
  });

  it("defaults to 0 for absent or junk values", () => {
    for (const value of [null, undefined, {}, { fallbackHop: "two" }, { fallbackHop: -1 }, "nope"]) {
      expect(readFallbackHop(value)).toBe(0);
    }
  });

  it("clamps above the hop cap", () => {
    expect(readFallbackHop({ fallbackHop: 9999 })).toBe(MAX_FALLBACK_HOPS);
  });
});
// [END: module]
