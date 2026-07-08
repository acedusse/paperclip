/**
 * FILE: server/src/__tests__/json-schema-secret-refs.test.ts
 * ABOUT: json-schema-secret-refs.test.ts (__tests__ module).
 *
 * SECTIONS:
 *   [TAG: module] - json-schema-secret-refs.test.ts (__tests__ module).
 */
// ==========================================
// [META: module]
// INTENT: json-schema-secret-refs.test.ts (__tests__ module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/__tests__/json-schema-secret-refs.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { collectSecretRefPaths } from "../services/json-schema-secret-refs.ts";

describe("collectSecretRefPaths", () => {
  it("collects nested secret-ref paths from object properties", () => {
    expect(Array.from(collectSecretRefPaths({
      type: "object",
      properties: {
        credentials: {
          type: "object",
          properties: {
            apiKey: { type: "string", format: "secret-ref" },
          },
        },
      },
    }))).toEqual(["credentials.apiKey"]);
  });

  it("collects secret-ref paths from JSON Schema composition keywords", () => {
    expect(Array.from(collectSecretRefPaths({
      type: "object",
      allOf: [
        {
          properties: {
            apiKey: { type: "string", format: "secret-ref" },
          },
        },
        {
          properties: {
            nested: {
              oneOf: [
                {
                  properties: {
                    token: { type: "string", format: "secret-ref" },
                  },
                },
              ],
            },
          },
        },
      ],
    })).sort()).toEqual(["apiKey", "nested.token"]);
  });
});
// [END: module]
