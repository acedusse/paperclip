/**
 * FILE: ui/src/adapters/http/config-fields.tsx
 * ABOUT: config-fields.tsx (http module).
 *
 * SECTIONS:
 *   [TAG: module] - config-fields.tsx (http module).
 */
// ==========================================
// [META: module]
// INTENT: config-fields.tsx (http module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/adapters/http/config-fields.tsx", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
  help,
} from "../../components/agent-config-primitives";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

export function HttpConfigFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
}: AdapterConfigFieldsProps) {
  return (
    <Field label="Webhook URL" hint={help.webhookUrl}>
      <DraftInput
        value={
          isCreate
            ? values!.url
            : eff("adapterConfig", "url", String(config.url ?? ""))
        }
        onCommit={(v) =>
          isCreate
            ? set!({ url: v })
            : mark("adapterConfig", "url", v || undefined)
        }
        immediate
        className={inputClass}
        placeholder="https://..."
      />
    </Field>
  );
}
// [END: module]
