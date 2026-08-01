/**
 * FILE: packages/adapter-utils/src/local-inference.ts
 * ABOUT: local-inference.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - local-inference.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: local-inference.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/adapter-utils/src/local-inference.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]

/**
 * Decides whether an OpenAI-compatible run is served by a *local* inference endpoint,
 * which bills at $0.
 *
 * The load-bearing rule: **$0 is never inferred, only declared.** Gateways and proxies
 * (LiteLLM, openclaw) routinely listen on loopback and forward to paid providers, so a
 * host-shape heuristic alone would silently zero out real spend. Classification therefore
 * requires an explicit operator opt-in *and* a genuinely local host; either one alone
 * falls back to normal billing.
 */

/** Env var an operator sets, alongside OPENAI_BASE_URL, to declare an endpoint free. */
export const LOCAL_INFERENCE_ENV_VAR = "PAPERCLIP_LOCAL_INFERENCE";

/** Biller slug recorded for local runs. */
export const LOCAL_BILLER = "local";

/** Known local-model runtimes, identified by conventional port. Advisory only. */
export type LocalInferenceRuntime = "ollama" | "lm_studio" | "llama_cpp";

export interface LocalInferenceClassification {
  /** the $0 decision: opt-in AND a local host */
  isLocal: boolean;
  /** true = declared local, false = explicitly declared paid, null = not stated */
  optIn: boolean | null;
  baseUrl: string | null;
  host: string | null;
  port: number | null;
  hostIsLocal: boolean;
  /**
   * Best guess at which local runtime is listening, from the port. A hint for presets and
   * probe messages — it NEVER contributes to `isLocal`, because ports like 8080 are at
   * least as common for proxies as for llama.cpp.
   */
  runtime: LocalInferenceRuntime | null;
  /** short human-readable justification, so a wrong verdict is diagnosable from a log */
  reason: string;
}

type EnvLike = NodeJS.ProcessEnv | Record<string, string>;

const BASE_URL_KEYS = ["OPENAI_BASE_URL", "OPENAI_API_BASE", "OPENAI_API_BASE_URL"] as const;

const TRUTHY = new Set(["1", "true", "yes", "on"]);
const FALSY = new Set(["0", "false", "no", "off"]);

const RUNTIME_BY_PORT: Record<number, LocalInferenceRuntime> = {
  11434: "ollama",
  1234: "lm_studio",
  8080: "llama_cpp",
};

function readEnv(env: EnvLike, key: string): string | null {
  const value = (env as Record<string, string | undefined>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readOptIn(env: EnvLike): boolean | null {
  const raw = readEnv(env, LOCAL_INFERENCE_ENV_VAR);
  if (raw === null) return null;
  const normalized = raw.toLowerCase();
  if (TRUTHY.has(normalized)) return true;
  if (FALSY.has(normalized)) return false;
  // An unrecognised value is not a declaration. Guessing here would be the same
  // failure mode the opt-in exists to prevent.
  return null;
}

function readBaseUrl(env: EnvLike): string | null {
  for (const key of BASE_URL_KEYS) {
    const value = readEnv(env, key);
    if (value !== null) return value;
  }
  return null;
}

/** Strips the brackets IPv6 authority syntax adds, e.g. "[::1]" -> "::1". */
function unwrapIpv6(hostname: string): string {
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

function isPrivateIpv4(host: string): boolean {
  const octets = host.split(".");
  if (octets.length !== 4) return false;

  const parsed: number[] = [];
  for (const octet of octets) {
    if (!/^\d{1,3}$/.test(octet)) return false;
    const value = Number(octet);
    if (value > 255) return false;
    parsed.push(value);
  }

  const [a, b] = parsed as [number, number, number, number];
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // RFC1918 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16.0.0/12 — spans .16-.31 only
  if (a === 192 && b === 168) return true; // RFC1918 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16
  return false;
}

function isLocalIpv6(host: string): boolean {
  const value = host.toLowerCase();
  if (value === "::1") return true; // loopback
  if (/^f[cd][0-9a-f]{0,2}:/.test(value)) return true; // unique local fc00::/7
  if (/^fe[89ab][0-9a-f]?:/.test(value)) return true; // link-local fe80::/10
  return false;
}

function isLocalHostname(hostname: string): boolean {
  const host = unwrapIpv6(hostname.trim().toLowerCase());
  if (host.length === 0) return false;
  if (host === "localhost") return true;
  if (host.endsWith(".localhost")) return true;
  if (host.endsWith(".local")) return true; // mDNS
  if (host.includes(":")) return isLocalIpv6(host);
  return isPrivateIpv4(host);
}

interface ParsedEndpoint {
  host: string | null;
  port: number | null;
}

/**
 * Total — never throws. This runs inside the billing path of an already-successful run,
 * so a malformed URL must degrade to "not local", not blow up the result.
 */
function parseEndpoint(baseUrl: string | null): ParsedEndpoint {
  if (baseUrl === null) return { host: null, port: null };
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return { host: null, port: null };
  }
  const hostname = url.hostname.trim();
  if (hostname.length === 0) return { host: null, port: null };
  const port = url.port.length > 0 ? Number(url.port) : null;
  return { host: hostname, port: Number.isFinite(port) ? port : null };
}

export function classifyLocalInference(env: EnvLike): LocalInferenceClassification {
  const optIn = readOptIn(env);
  const baseUrl = readBaseUrl(env);
  const { host, port } = parseEndpoint(baseUrl);
  const hostIsLocal = host !== null && isLocalHostname(host);
  const runtime = port !== null ? RUNTIME_BY_PORT[port] ?? null : null;

  const base = { optIn, baseUrl, host, port, hostIsLocal, runtime };

  if (optIn === false) {
    return { ...base, isLocal: false, reason: `explicit opt-out via ${LOCAL_INFERENCE_ENV_VAR}` };
  }
  if (baseUrl === null) {
    return { ...base, isLocal: false, reason: "no OpenAI-compatible base URL configured" };
  }
  if (optIn === null) {
    return {
      ...base,
      isLocal: false,
      reason: hostIsLocal
        ? `local host but no opt-in — set ${LOCAL_INFERENCE_ENV_VAR}=1 to bill this endpoint as free`
        : "no opt-in and host is not local",
    };
  }
  if (!hostIsLocal) {
    return {
      ...base,
      isLocal: false,
      reason: `${LOCAL_INFERENCE_ENV_VAR} is set but host ${host ?? "(unparseable)"} is not local`,
    };
  }
  return { ...base, isLocal: true, reason: `opt-in and local host ${host}` };
}

export function isLocalInferenceEnv(env: EnvLike): boolean {
  return classifyLocalInference(env).isLocal;
}

export interface LocalBillingOverride {
  biller: typeof LOCAL_BILLER;
  billingType: "local";
  costUsd: 0;
}

/**
 * The billing fields a local run must record, or null to leave billing untouched.
 * Token counts are deliberately NOT part of this — usage must survive so productivity
 * metrics keep working when spend is zero.
 */
export function localBillingOverride(env: EnvLike): LocalBillingOverride | null {
  if (!isLocalInferenceEnv(env)) return null;
  return { biller: LOCAL_BILLER, billingType: "local", costUsd: 0 };
}
// [END: module]
