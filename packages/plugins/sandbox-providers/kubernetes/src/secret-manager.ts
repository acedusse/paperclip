/**
 * FILE: packages/plugins/sandbox-providers/kubernetes/src/secret-manager.ts
 * ABOUT: secret-manager.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - secret-manager.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: secret-manager.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sandbox-providers/kubernetes/src/secret-manager.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import type { KubeClients } from "./kube-client.js";

export interface CreatePerRunSecretInput {
  namespace: string;
  secretName: string;
  runId: string;
  ownerKind: string;
  ownerApiVersion: string;
  ownerName: string;
  ownerUid: string;
  bootstrapToken: string;
  adapterEnv: Record<string, string>;
}

export async function createPerRunSecret(clients: KubeClients, input: CreatePerRunSecretInput): Promise<void> {
  if (!input.ownerUid) {
    throw new Error("createPerRunSecret requires a non-empty ownerUid");
  }
  if ("BOOTSTRAP_TOKEN" in input.adapterEnv) {
    throw new Error("adapterEnv must not contain BOOTSTRAP_TOKEN (reserved key)");
  }
  await clients.core.createNamespacedSecret({
    namespace: input.namespace,
    body: {
      apiVersion: "v1",
      kind: "Secret",
      type: "Opaque",
      metadata: {
        name: input.secretName,
        namespace: input.namespace,
        labels: {
          "paperclip.io/run-id": input.runId,
          "paperclip.io/managed-by": "paperclip-k8s-plugin",
        },
        ownerReferences: [
          {
            apiVersion: input.ownerApiVersion,
            kind: input.ownerKind,
            name: input.ownerName,
            uid: input.ownerUid,
            controller: true,
            blockOwnerDeletion: true,
          },
        ],
      },
      stringData: {
        BOOTSTRAP_TOKEN: input.bootstrapToken,
        ...input.adapterEnv,
      },
    },
  });
}
// [END: module]
