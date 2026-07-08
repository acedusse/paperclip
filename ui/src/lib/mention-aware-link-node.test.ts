/**
 * FILE: ui/src/lib/mention-aware-link-node.test.ts
 * ABOUT: mention-aware-link-node.test.ts (lib module).
 *
 * SECTIONS:
 *   [TAG: module] - mention-aware-link-node.test.ts (lib module).
 */
// ==========================================
// [META: module]
// INTENT: mention-aware-link-node.test.ts (lib module).
// PSEUDOCODE: 1. Load dependencies. 2. Define module members. 3. Export public API.
// JSON_FLOW: {"file": "ui/src/lib/mention-aware-link-node.test.ts", "imports": "see code", "exports": "see code"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import { $createLinkNode } from "@lexical/link";
import { createEditor } from "lexical";
import {
  MentionAwareLinkNode,
  getMentionAwareLinkNodeInit,
  mentionAwareLinkNodeReplacement,
} from "./mention-aware-link-node";

function createTestEditor() {
  return createEditor({
    namespace: "mention-aware-link-node-test",
    nodes: [MentionAwareLinkNode, mentionAwareLinkNodeReplacement],
    onError(error: Error) {
      throw error;
    },
  });
}

describe("getMentionAwareLinkNodeInit", () => {
  it("copies link attributes without carrying over a node key", () => {
    const init = getMentionAwareLinkNodeInit({
      getURL: () => "agent://agent-123",
      getRel: () => "noreferrer",
      getTarget: () => "_blank",
      getTitle: () => "Agent mention",
    });

    expect(Object.keys(init)).toEqual(["url", "attributes"]);
    expect(init).toEqual({
      url: "agent://agent-123",
      attributes: {
        rel: "noreferrer",
        target: "_blank",
        title: "Agent mention",
      },
    });
  });

  it("replaces LinkNode creation with MentionAwareLinkNode without throwing", () => {
    const editor = createTestEditor();
    let created: unknown;

    editor.update(() => {
      created = $createLinkNode("agent://agent-123");
    });

    expect(created).toBeInstanceOf(MentionAwareLinkNode);
  });
});
// [END: module]
