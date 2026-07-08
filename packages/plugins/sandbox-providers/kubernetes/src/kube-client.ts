/**
 * FILE: packages/plugins/sandbox-providers/kubernetes/src/kube-client.ts
 * ABOUT: kube-client.ts (src module).
 *
 * SECTIONS:
 *   [TAG: module] - kube-client.ts (src module).
 */
// ==========================================
// [META: module]
// INTENT: kube-client.ts (src module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "packages/plugins/sandbox-providers/kubernetes/src/kube-client.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import {
  KubeConfig,
  CoreV1Api,
  BatchV1Api,
  CustomObjectsApi,
  NetworkingV1Api,
  RbacAuthorizationV1Api,
} from "@kubernetes/client-node";

export interface CreateKubeConfigInput {
  inCluster?: boolean;
  kubeconfig?: string;
}

export function createKubeConfig(input: CreateKubeConfigInput): KubeConfig {
  const kc = new KubeConfig();
  if (input.inCluster) {
    kc.loadFromCluster();
    return kc;
  }
  if (input.kubeconfig && input.kubeconfig.trim().length > 0) {
    kc.loadFromString(input.kubeconfig);
    return kc;
  }
  throw new Error("createKubeConfig requires either inCluster=true or a kubeconfig string");
}

export interface KubeClients {
  core: CoreV1Api;
  batch: BatchV1Api;
  custom: CustomObjectsApi;
  networking: NetworkingV1Api;
  rbac: RbacAuthorizationV1Api;
}

export function makeKubeClients(kc: KubeConfig): KubeClients {
  return {
    core: kc.makeApiClient(CoreV1Api),
    batch: kc.makeApiClient(BatchV1Api),
    custom: kc.makeApiClient(CustomObjectsApi),
    networking: kc.makeApiClient(NetworkingV1Api),
    rbac: kc.makeApiClient(RbacAuthorizationV1Api),
  };
}
// [END: module]
