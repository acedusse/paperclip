/**
 * FILE: server/src/services/telegram-format.test.ts
 * ABOUT: telegram-format.test.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - unit tests for the Telegram message/callback codec and HTML rendering.
 */
// ==========================================
// [META: module]
// INTENT: Pin the wire shape the Telegram channel sends — HTML-escaped rich text, the inline control
//   layout, and the callback payload that carries a decision back — against the documented Bot API
//   limits (text 1-4096, callback_data 1-64 bytes, callback answer text 200).
// PSEUDOCODE: 1. Encode/decode approval callbacks. 2. Reject malformed callback data.
//   3. Build the approval message: HTML escaping, band chip, controls, truncation.
// JSON_FLOW: {"file": "server/src/services/telegram-format.test.ts", "imports": "vitest, ./telegram-format.js", "exports": "none"}
// ==========================================
// [START: module]
import { describe, expect, it } from "vitest";
import {
  TELEGRAM_CALLBACK_ANSWER_LIMIT,
  TELEGRAM_CAPTION_LIMIT,
  TELEGRAM_TEXT_LIMIT,
  buildAlertMessage,
  buildApprovalMessage,
  buildDecisionAck,
  buildLinkedMessage,
  decodeApprovalCallback,
  encodeApprovalCallback,
  escapeHtml,
  truncateForTelegram,
} from "./telegram-format.js";

const APPROVAL_ID = "6f1d5b9c-2a4e-4c3f-9b7a-1d2e3f4a5b6c";

describe("approval callback codec", () => {
  it("round-trips an approve decision", () => {
    const data = encodeApprovalCallback({ approvalId: APPROVAL_ID, outcome: "approve" });
    expect(decodeApprovalCallback(data)).toEqual({ approvalId: APPROVAL_ID, outcome: "approve" });
  });

  it("round-trips a reject decision", () => {
    const data = encodeApprovalCallback({ approvalId: APPROVAL_ID, outcome: "reject" });
    expect(decodeApprovalCallback(data)).toEqual({ approvalId: APPROVAL_ID, outcome: "reject" });
  });

  it("stays inside Telegram's documented 64-byte callback_data limit", () => {
    const data = encodeApprovalCallback({ approvalId: APPROVAL_ID, outcome: "approve" });
    expect(Buffer.byteLength(data, "utf8")).toBeLessThanOrEqual(64);
  });

  it("returns null for callback data from another feature", () => {
    expect(decodeApprovalCallback("noise")).toBeNull();
    expect(decodeApprovalCallback("apv:x:" + APPROVAL_ID)).toBeNull();
    expect(decodeApprovalCallback("apv:a:not-a-uuid")).toBeNull();
    expect(decodeApprovalCallback("")).toBeNull();
  });
});

describe("escapeHtml", () => {
  it("escapes the three characters Telegram's HTML mode reserves", () => {
    expect(escapeHtml(`a & b < c > d`)).toBe("a &amp; b &lt; c &gt; d");
  });

  it("escapes ampersands before angle brackets so entities are not double-encoded", () => {
    expect(escapeHtml("&lt;")).toBe("&amp;lt;");
  });

  it("neutralises markup an agent put in an approval title", () => {
    expect(escapeHtml('<b onclick="x">boom</b>')).not.toContain("<b");
  });
});

describe("truncateForTelegram", () => {
  it("leaves short text alone", () => {
    expect(truncateForTelegram("hello", 100)).toBe("hello");
  });

  it("clips over-long text to the limit including its ellipsis", () => {
    const out = truncateForTelegram("x".repeat(200), 50);
    expect(out.length).toBeLessThanOrEqual(50);
    expect(out.endsWith("…")).toBe(true);
  });

  it("never splits an HTML entity across the cut", () => {
    const out = truncateForTelegram(`${"x".repeat(45)}&amp;yyyy`, 50);
    expect(out).not.toMatch(/&[a-z]*$/);
  });
});

describe("buildApprovalMessage", () => {
  const base = {
    title: "critical risk approval",
    body: "budget_override_required — tap to review",
    url: `/approvals/${APPROVAL_ID}`,
    approvalId: APPROVAL_ID,
    band: "critical",
  };

  it("renders the title in bold HTML", () => {
    const msg = buildApprovalMessage({ ...base, baseUrl: null });
    expect(msg.parseMode).toBe("HTML");
    expect(msg.text).toContain("<b>");
    expect(msg.text).toContain("critical risk approval");
  });

  it("leads with a colour chip for the risk band", () => {
    expect(buildApprovalMessage({ ...base, band: "critical", baseUrl: null }).text).toContain("🔴");
    expect(buildApprovalMessage({ ...base, band: "high", baseUrl: null }).text).toContain("🟠");
    expect(buildApprovalMessage({ ...base, band: "medium", baseUrl: null }).text).toContain("🟡");
    expect(buildApprovalMessage({ ...base, band: "low", baseUrl: null }).text).toContain("🟢");
  });

  it("escapes operator and agent supplied text rather than rendering it as markup", () => {
    const msg = buildApprovalMessage({ ...base, body: "<i>ship</i> & <script>x</script>", baseUrl: null });
    expect(msg.text).toContain("&lt;i&gt;ship&lt;/i&gt;");
    expect(msg.text).toContain("&amp;");
    expect(msg.text).not.toContain("<script>");
  });

  it("quotes the summary body so it reads apart from the headline", () => {
    expect(buildApprovalMessage({ ...base, baseUrl: null }).text).toContain("<blockquote>");
  });

  it("suppresses the link preview so the card does not bury the controls", () => {
    expect(buildApprovalMessage({ ...base, baseUrl: "https://ops.example.com" }).linkPreviewDisabled).toBe(true);
  });

  it("offers Approve and Reject controls carrying decodable callbacks", () => {
    const row = buildApprovalMessage({ ...base, baseUrl: null }).replyMarkup!.inline_keyboard[0]!;
    expect(decodeApprovalCallback(row[0]!.callback_data!)).toEqual({ approvalId: APPROVAL_ID, outcome: "approve" });
    expect(decodeApprovalCallback(row[1]!.callback_data!)).toEqual({ approvalId: APPROVAL_ID, outcome: "reject" });
  });

  it("adds an Open-in-Paperclip link control on its own row when a base URL is set", () => {
    const rows = buildApprovalMessage({ ...base, baseUrl: "https://ops.example.com" }).replyMarkup!.inline_keyboard;
    expect(rows).toHaveLength(2);
    expect(rows[1]![0]!.url).toBe(`https://ops.example.com/approvals/${APPROVAL_ID}`);
    expect(rows[1]![0]!.callback_data).toBeUndefined();
  });

  it("omits the link control entirely when no base URL is configured", () => {
    const rows = buildApprovalMessage({ ...base, baseUrl: null }).replyMarkup!.inline_keyboard;
    expect(rows).toHaveLength(1);
  });

  it("adds a Review in full web_app button when a mini app url is given", () => {
    const msg = buildApprovalMessage({
      title: "Critical risk approval",
      body: "Increase the cap",
      url: `/approvals/${APPROVAL_ID}`,
      approvalId: APPROVAL_ID,
      band: "critical",
      baseUrl: "https://paperclip.example",
      miniAppUrl: "https://paperclip.example/telegram/app?c=abc",
    });
    const flat = msg.replyMarkup!.inline_keyboard.flat();
    const webApp = flat.find((b) => b.web_app);
    expect(webApp?.web_app?.url).toBe("https://paperclip.example/telegram/app?c=abc");
    expect(webApp?.text).toMatch(/review in full/i);
  });

  it("keeps the Approve and Reject controls alongside the web_app button", () => {
    const msg = buildApprovalMessage({
      title: "Critical risk approval",
      body: "Increase the cap",
      url: `/approvals/${APPROVAL_ID}`,
      approvalId: APPROVAL_ID,
      miniAppUrl: "https://paperclip.example/telegram/app?c=abc",
    });
    const flat = msg.replyMarkup!.inline_keyboard.flat();
    expect(flat.filter((b) => b.callback_data)).toHaveLength(2);
  });

  it("omits the web_app button when no mini app url is given", () => {
    const msg = buildApprovalMessage({
      title: "Critical risk approval",
      body: "Increase the cap",
      url: `/approvals/${APPROVAL_ID}`,
      approvalId: APPROVAL_ID,
    });
    expect(JSON.stringify(msg.replyMarkup)).not.toContain("web_app");
  });

  it("names the requester and linked issues when they are known", () => {
    const msg = buildApprovalMessage({
      ...base,
      baseUrl: null,
      requestedBy: "Atlas",
      linkedIssues: ["PAP-14", "PAP-15"],
    });
    expect(msg.text).toContain("Atlas");
    expect(msg.text).toContain("PAP-14");
  });

  it("keeps the rendered text inside the sendMessage limit", () => {
    const msg = buildApprovalMessage({ ...base, body: "y".repeat(9000), baseUrl: null });
    expect(msg.text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
  });

  it("keeps the caption variant inside the tighter caption limit", () => {
    const msg = buildApprovalMessage({ ...base, body: "y".repeat(9000), baseUrl: null, asCaption: true });
    expect(msg.text.length).toBeLessThanOrEqual(TELEGRAM_CAPTION_LIMIT);
  });
});

describe("buildDecisionAck", () => {
  it("confirms an applied approval", () => {
    expect(buildDecisionAck({ outcome: "approve", applied: true })).toBe("Approved");
  });

  it("says nothing changed when the approval was already settled", () => {
    expect(buildDecisionAck({ outcome: "approve", applied: false })).toMatch(/already/i);
  });

  it("stays inside the callback answer limit even for a long denial reason", () => {
    const ack = buildDecisionAck({ outcome: "reject", applied: true, detail: "z".repeat(500) });
    expect(ack.length).toBeLessThanOrEqual(TELEGRAM_CALLBACK_ANSWER_LIMIT);
  });
});

describe("buildAlertMessage", () => {
  const alert = { title: "Approvals past SLA", body: "3 approvals awaiting a decision", url: "/approvals/triage" };

  it("renders the headline and the detail", () => {
    const msg = buildAlertMessage(alert);
    expect(msg.text).toContain("Approvals past SLA");
    expect(msg.text).toContain("3 approvals awaiting a decision");
  });

  it("carries a link button when the company set a public base URL", () => {
    const msg = buildAlertMessage({ ...alert, baseUrl: "https://paperclip.example" });
    expect(msg.replyMarkup!.inline_keyboard[0]![0]!.url).toBe("https://paperclip.example/approvals/triage");
  });

  it("carries no controls at all without a public base URL, rather than a button that goes nowhere", () => {
    expect(buildAlertMessage(alert).replyMarkup).toBeUndefined();
  });

  it("never carries decision controls — there is no decision to encode", () => {
    const msg = buildAlertMessage({ ...alert, baseUrl: "https://paperclip.example" });
    expect(JSON.stringify(msg.replyMarkup)).not.toContain("callback_data");
  });

  it("uses the risk chip for the band", () => {
    expect(buildAlertMessage({ ...alert, band: "critical" }).text.startsWith("🔴")).toBe(true);
    expect(buildAlertMessage({ ...alert, band: "nonsense" }).text.startsWith("⚪️")).toBe(true);
  });

  it("escapes markup in a title or body, which may be agent-authored", () => {
    const msg = buildAlertMessage({ ...alert, title: "5 < 6 & rising", body: "<script>x</script>" });
    expect(msg.text).toContain("5 &lt; 6 &amp; rising");
    expect(msg.text).toContain("&lt;script&gt;");
  });

  it("stays inside the text limit for a very long body", () => {
    const msg = buildAlertMessage({ ...alert, body: "z".repeat(9000) });
    expect(msg.text.length).toBeLessThanOrEqual(TELEGRAM_TEXT_LIMIT);
  });

  it("omits the quoted detail entirely when the body is blank", () => {
    expect(buildAlertMessage({ ...alert, body: "   " }).text).not.toContain("blockquote");
  });
});

describe("buildLinkedMessage", () => {
  it("names the company the chat was bound to", () => {
    expect(buildLinkedMessage({ companyName: "Acme Co" }).text).toContain("Acme Co");
  });

  it("escapes a company name containing markup", () => {
    expect(buildLinkedMessage({ companyName: "A<b>C</b>" }).text).toContain("&lt;b&gt;");
  });

  it("carries no controls", () => {
    expect(buildLinkedMessage({ companyName: "Acme Co" }).replyMarkup).toBeUndefined();
  });
});
// [END: module]
