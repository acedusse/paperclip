/**
 * FILE: server/src/middleware/validate.ts
 * ABOUT: validate.ts (middleware module).
 *
 * SECTIONS:
 *   [TAG: module] - validate.ts (middleware module).
 */
// ==========================================
// [META: module]
// INTENT: validate.ts (middleware module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "server/src/middleware/validate.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { Request, Response, NextFunction } from "express";
import type { ZodSchema } from "zod";

export function validate(schema: ZodSchema) {
  return (req: Request, _res: Response, next: NextFunction) => {
    req.body = schema.parse(req.body);
    next();
  };
}
// [END: module]
