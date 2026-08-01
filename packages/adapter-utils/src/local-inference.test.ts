/**
 * FILE: packages/adapter-utils/src/local-inference.test.ts
 * ABOUT: local-inference.test.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - local-inference.test.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: local-inference.test.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapter-utils/src/local-inference.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  LOCAL_BILLER,
  LOCAL_INFERENCE_ENV_VAR,
  classifyLocalInference,
  isLocalInferenceEnv,
  localBillingOverride,
} from "./local-inference.js";

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

/** opted-in env pointing at the given base URL */
function optedIn(baseUrl: string): NodeJS.ProcessEnv {
  return env({ [LOCAL_INFERENCE_ENV_VAR]: "1", OPENAI_BASE_URL: baseUrl });
}

describe("classifyLocalInference — host locality", () => {
  const localHosts = [
    "http://localhost:11434/v1",
    "http://LOCALHOST:11434/v1",
    "http://127.0.0.1:1234/v1",
    "http://127.0.0.53:8080/v1",
    "http://[::1]:11434/v1",
    "http://workstation.local:1234/v1",
    "http://10.0.0.5:11434/v1",
    "http://10.255.255.255:11434/v1",
    "http://172.16.0.1:11434/v1",
    "http://172.31.255.254:11434/v1",
    "http://192.168.1.50:1234/v1",
    "http://169.254.10.1:11434/v1",
    "http://[fd00::1]:11434/v1",
    "http://[fe80::1]:11434/v1",
  ];

  for (const baseUrl of localHosts) {
    it(`treats ${baseUrl} as a local host`, () => {
      const result = classifyLocalInference(optedIn(baseUrl));
      expect(result.hostIsLocal).toBe(true);
      expect(result.isLocal).toBe(true);
    });
  }

  const publicHosts = [
    "https://api.openai.com/v1",
    "https://openrouter.ai/api/v1",
    "http://8.8.8.8:11434/v1",
    // the classic RFC1918 off-by-one: 172.16/12 spans 172.16-172.31 only
    "http://172.15.0.1:11434/v1",
    "http://172.32.0.1:11434/v1",
    // 11.x is not private even though 10.x is
    "http://11.0.0.1:11434/v1",
    // .localdomain is not .local
    "http://box.localdomain:11434/v1",
    // hostname merely containing "localhost" is not loopback
    "http://notlocalhost.example.com/v1",
  ];

  for (const baseUrl of publicHosts) {
    it(`treats ${baseUrl} as a non-local host`, () => {
      const result = classifyLocalInference(optedIn(baseUrl));
      expect(result.hostIsLocal).toBe(false);
      expect(result.isLocal).toBe(false);
    });
  }
});

describe("classifyLocalInference — opt-in is required for $0", () => {
  it("is local when opt-in is set and the host is local", () => {
    const result = classifyLocalInference(optedIn("http://localhost:11434/v1"));
    expect(result.isLocal).toBe(true);
    expect(result.optIn).toBe(true);
  });

  it("is NOT local when the host is local but there is no opt-in", () => {
    const result = classifyLocalInference(env({ OPENAI_BASE_URL: "http://localhost:11434/v1" }));
    expect(result.isLocal).toBe(false);
    expect(result.optIn).toBeNull();
    expect(result.hostIsLocal).toBe(true);
    expect(result.reason).toContain("no opt-in");
  });

  it("is NOT local when opt-in is set but the host is public", () => {
    const result = classifyLocalInference(optedIn("https://api.openai.com/v1"));
    expect(result.isLocal).toBe(false);
    expect(result.optIn).toBe(true);
    expect(result.hostIsLocal).toBe(false);
    expect(result.reason).toContain("not local");
  });

  it("is NOT local when there is no base URL at all", () => {
    const result = classifyLocalInference(env({ [LOCAL_INFERENCE_ENV_VAR]: "1" }));
    expect(result.isLocal).toBe(false);
    expect(result.baseUrl).toBeNull();
  });

  for (const truthy of ["1", "true", "TRUE", "yes", "on", " true "]) {
    it(`accepts ${JSON.stringify(truthy)} as opt-in`, () => {
      const result = classifyLocalInference(
        env({ [LOCAL_INFERENCE_ENV_VAR]: truthy, OPENAI_BASE_URL: "http://localhost:11434/v1" }),
      );
      expect(result.isLocal).toBe(true);
    });
  }

  // The paid-proxy escape hatch: an operator running a billed gateway on Ollama's port
  // must be able to force it back to normal billing.
  for (const falsy of ["0", "false", "no", "off"]) {
    it(`treats ${JSON.stringify(falsy)} as an explicit opt-out even on a local host`, () => {
      const result = classifyLocalInference(
        env({ [LOCAL_INFERENCE_ENV_VAR]: falsy, OPENAI_BASE_URL: "http://localhost:11434/v1" }),
      );
      expect(result.isLocal).toBe(false);
      expect(result.optIn).toBe(false);
      expect(result.reason).toContain("opt-out");
    });
  }

  it("ignores an unrecognised opt-in value rather than guessing", () => {
    const result = classifyLocalInference(
      env({ [LOCAL_INFERENCE_ENV_VAR]: "maybe", OPENAI_BASE_URL: "http://localhost:11434/v1" }),
    );
    expect(result.isLocal).toBe(false);
    expect(result.optIn).toBeNull();
  });
});

describe("classifyLocalInference — runtime hints never grant $0", () => {
  it("hints ollama on port 11434", () => {
    expect(classifyLocalInference(optedIn("http://localhost:11434/v1")).runtime).toBe("ollama");
  });

  it("hints lm_studio on port 1234", () => {
    expect(classifyLocalInference(optedIn("http://localhost:1234/v1")).runtime).toBe("lm_studio");
  });

  it("hints llama_cpp on port 8080", () => {
    expect(classifyLocalInference(optedIn("http://localhost:8080/v1")).runtime).toBe("llama_cpp");
  });

  it("populates the runtime hint WITHOUT opting in — the hint alone is never enough", () => {
    const result = classifyLocalInference(env({ OPENAI_BASE_URL: "http://localhost:11434/v1" }));
    expect(result.runtime).toBe("ollama");
    expect(result.isLocal).toBe(false);
  });

  it("has no hint for an unrecognised port", () => {
    expect(classifyLocalInference(optedIn("http://localhost:4000/v1")).runtime).toBeNull();
  });
});

describe("classifyLocalInference — base URL aliases and robustness", () => {
  for (const key of ["OPENAI_BASE_URL", "OPENAI_API_BASE", "OPENAI_API_BASE_URL"]) {
    it(`reads the base URL from ${key}`, () => {
      const result = classifyLocalInference(
        env({ [LOCAL_INFERENCE_ENV_VAR]: "1", [key]: "http://localhost:11434/v1" }),
      );
      expect(result.isLocal).toBe(true);
    });
  }

  it("prefers OPENAI_BASE_URL over the aliases", () => {
    const result = classifyLocalInference(
      env({
        [LOCAL_INFERENCE_ENV_VAR]: "1",
        OPENAI_BASE_URL: "https://api.openai.com/v1",
        OPENAI_API_BASE: "http://localhost:11434/v1",
      }),
    );
    expect(result.isLocal).toBe(false);
  });

  for (const bad of ["not a url", "", "   ", "://missing-scheme", "http://"]) {
    it(`is total for a malformed base URL ${JSON.stringify(bad)}`, () => {
      const result = classifyLocalInference(env({ [LOCAL_INFERENCE_ENV_VAR]: "1", OPENAI_BASE_URL: bad }));
      expect(result.isLocal).toBe(false);
      expect(result.hostIsLocal).toBe(false);
    });
  }

  it("accepts a base URL with no explicit port", () => {
    const result = classifyLocalInference(optedIn("http://localhost/v1"));
    expect(result.isLocal).toBe(true);
    expect(result.port).toBeNull();
    expect(result.runtime).toBeNull();
  });

  it("always reports a non-empty reason", () => {
    for (const candidate of [
      optedIn("http://localhost:11434/v1"),
      env({ OPENAI_BASE_URL: "http://localhost:11434/v1" }),
      env({}),
    ]) {
      expect(classifyLocalInference(candidate).reason.length).toBeGreaterThan(0);
    }
  });
});

describe("isLocalInferenceEnv", () => {
  it("mirrors classifyLocalInference().isLocal", () => {
    expect(isLocalInferenceEnv(optedIn("http://localhost:11434/v1"))).toBe(true);
    expect(isLocalInferenceEnv(env({ OPENAI_BASE_URL: "http://localhost:11434/v1" }))).toBe(false);
  });
});

describe("localBillingOverride", () => {
  it("returns a $0 local override for a declared local endpoint", () => {
    expect(localBillingOverride(optedIn("http://localhost:11434/v1"))).toEqual({
      biller: LOCAL_BILLER,
      billingType: "local",
      costUsd: 0,
    });
  });

  it("returns null when the run is not local, so callers keep current behaviour", () => {
    expect(localBillingOverride(env({ OPENAI_BASE_URL: "https://api.openai.com/v1" }))).toBeNull();
    expect(localBillingOverride(env({ OPENAI_BASE_URL: "http://localhost:11434/v1" }))).toBeNull();
  });
});
// [END: module]
