/**
 * FILE: server/src/services/telegram-format.ts
 * ABOUT: telegram-format.ts (services module).
 *
 * SECTIONS:
 *   [TAG: module] - pure Telegram message rendering, HTML escaping, and the approval callback codec.
 */
// ==========================================
// [META: module]
// INTENT: Turn an approval notification into the exact Telegram sendMessage/sendPhoto body — HTML-styled
//   so the operator reads a headline, a risk chip and a quoted summary rather than a wall of text — and
//   encode/decode the inline-control payload that carries a decision back. Pure: no db, network or clock.
// PSEUDOCODE: 1. encodeApprovalCallback packs (outcome, approvalId) into a <=64 byte token (documented
//   limit "1-64 bytes"). 2. decodeApprovalCallback validates prefix, outcome letter and uuid, else null.
//   3. escapeHtml neutralises the three characters HTML parse_mode reserves. 4. buildApprovalMessage
//   renders the card + control rows, truncated to the documented 4096 text / 1024 caption limits.
// JSON_FLOW: {"file": "server/src/services/telegram-format.ts", "imports": "none", "exports": "escapeHtml, truncateForTelegram, encodeApprovalCallback, decodeApprovalCallback, buildApprovalMessage, buildLinkedMessage, buildDecisionAck, TelegramMessage"}
// ==========================================
// [START: module]

/** Telegram caps callback_data at 64 bytes, so the token is a fixed prefix + outcome letter + uuid. */
const CALLBACK_PREFIX = "apv";
const OUTCOME_CODES = { approve: "a", reject: "r" } as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Documented Bot API limits. sendMessage text is "1-4096 characters after entities parsing". */
export const TELEGRAM_TEXT_LIMIT = 4096;
export const TELEGRAM_CAPTION_LIMIT = 1024;
export const TELEGRAM_CALLBACK_ANSWER_LIMIT = 200;

const BAND_CHIP: Record<string, string> = {
  low: "🟢",
  medium: "🟡",
  high: "🟠",
  critical: "🔴",
};

export type ApprovalOutcome = keyof typeof OUTCOME_CODES;
/** InlineKeyboardButton: `text` plus exactly one action field — callback_data, url, or web_app. */
export type TelegramInlineButton = {
  text: string;
  callback_data?: string;
  url?: string;
  web_app?: { url: string };
};
export type TelegramMessage = {
  text: string;
  parseMode?: "HTML";
  linkPreviewDisabled?: boolean;
  replyMarkup?: { inline_keyboard: TelegramInlineButton[][] };
};

export function encodeApprovalCallback(input: { approvalId: string; outcome: ApprovalOutcome }): string {
  return `${CALLBACK_PREFIX}:${OUTCOME_CODES[input.outcome]}:${input.approvalId}`;
}

/** Parse a tapped control back into a decision. Returns null for anything we did not mint. */
export function decodeApprovalCallback(data: string | null | undefined): { approvalId: string; outcome: ApprovalOutcome } | null {
  if (!data) return null;
  const parts = data.split(":");
  if (parts.length !== 3) return null;
  const [prefix, code, approvalId] = parts as [string, string, string];
  if (prefix !== CALLBACK_PREFIX) return null;
  const outcome = (Object.keys(OUTCOME_CODES) as ApprovalOutcome[]).find((k) => OUTCOME_CODES[k] === code);
  if (!outcome) return null;
  if (!UUID_RE.test(approvalId)) return null;
  return { approvalId, outcome };
}

/**
 * HTML parse_mode reserves exactly three characters. Ampersand must go first, or the entities this
 * function itself introduces would be re-escaped. Approval titles and bodies are agent-authored, so
 * everything interpolated into a message goes through here.
 */
export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Clip to a hard character budget, ellipsis included. Cuts back off a trailing partial HTML entity so
 * a truncated message can never end mid-`&amp;` and break parsing.
 */
export function truncateForTelegram(value: string, limit: number): string {
  if (value.length <= limit) return value;
  let cut = value.slice(0, Math.max(0, limit - 1));
  cut = cut.replace(/&[a-zA-Z#0-9]*$/, "");
  return `${cut}…`;
}

function joinMeta(parts: string[]): string | null {
  const kept = parts.filter((p) => p.length > 0);
  return kept.length > 0 ? kept.join(" · ") : null;
}

/**
 * The approval card. Rendered as HTML so the headline, the risk chip, the metadata line and the quoted
 * summary are visually distinct on a phone; every interpolated value is escaped first.
 *
 * `asCaption` renders the same card against the tighter caption budget, for when it rides along with a
 * photo or document instead of being its own text message.
 */
export function buildApprovalMessage(input: {
  title: string;
  body: string;
  url: string;
  approvalId: string;
  band?: string;
  baseUrl?: string | null;
  requestedBy?: string | null;
  linkedIssues?: string[];
  asCaption?: boolean;
  miniAppUrl?: string | null;
}): TelegramMessage {
  const limit = input.asCaption ? TELEGRAM_CAPTION_LIMIT : TELEGRAM_TEXT_LIMIT;
  const chip = BAND_CHIP[input.band ?? ""] ?? "⚪️";
  const link = absoluteLink(input.baseUrl, input.url);

  const meta = joinMeta([
    input.requestedBy ? `Requested by ${escapeHtml(input.requestedBy)}` : "",
    input.linkedIssues?.length ? escapeHtml(input.linkedIssues.join(", ")) : "",
  ]);

  const lines = [`${chip} <b>${escapeHtml(input.title)}</b>`];
  if (meta) lines.push(`<i>${meta}</i>`);
  if (input.body.trim()) lines.push(`<blockquote>${escapeHtml(input.body)}</blockquote>`);

  const controls: TelegramInlineButton[][] = [
    [
      { text: "✅ Approve", callback_data: encodeApprovalCallback({ approvalId: input.approvalId, outcome: "approve" }) },
      { text: "❌ Reject", callback_data: encodeApprovalCallback({ approvalId: input.approvalId, outcome: "reject" }) },
    ],
  ];
  // A url button is a plain deep link, so the board is one tap away without spending the message body
  // on a raw URL. Only offered when the company told us its public base URL.
  if (input.miniAppUrl) {
    // Opens the board inside Telegram, already authenticated — the escape hatch for an approval two
    // buttons cannot settle.
    controls.push([{ text: "🔎 Review in full", web_app: { url: input.miniAppUrl } }]);
  } else if (link) {
    controls.push([{ text: "🔗 Open in Paperclip", url: link }]);
  }

  return {
    text: truncateForTelegram(lines.join("\n"), limit),
    parseMode: "HTML",
    linkPreviewDisabled: true,
    replyMarkup: { inline_keyboard: controls },
  };
}

/**
 * The card for a notification that is not a single approval — an SLA breach, a budget incident, a SEV1.
 * There is no decision to encode, so it carries a link instead of controls; everything else about the
 * shape (chip, bold headline, quoted detail, escaping) matches the approval card so the two read as one
 * channel rather than two.
 */
export function buildAlertMessage(input: {
  title: string;
  body: string;
  url: string;
  band?: string;
  baseUrl?: string | null;
}): TelegramMessage {
  const chip = BAND_CHIP[input.band ?? ""] ?? "⚪️";
  const link = absoluteLink(input.baseUrl, input.url);

  const lines = [`${chip} <b>${escapeHtml(input.title)}</b>`];
  if (input.body.trim()) lines.push(`<blockquote>${escapeHtml(input.body)}</blockquote>`);

  return {
    text: truncateForTelegram(lines.join("\n"), TELEGRAM_TEXT_LIMIT),
    parseMode: "HTML",
    linkPreviewDisabled: true,
    ...(link ? { replyMarkup: { inline_keyboard: [[{ text: "🔗 Open in Paperclip", url: link }]] } } : {}),
  };
}

function absoluteLink(baseUrl: string | null | undefined, path: string): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(path, baseUrl).toString();
  } catch {
    return null;
  }
}

export function buildLinkedMessage(input: { companyName: string }): TelegramMessage {
  return {
    text: truncateForTelegram(
      `✅ This chat is now linked to <b>${escapeHtml(input.companyName)}</b>.\nApprovals that need you will arrive here.`,
      TELEGRAM_TEXT_LIMIT,
    ),
    parseMode: "HTML",
  };
}

/** The toast Telegram shows on the tapping device, inside the documented answer-text budget. */
export function buildDecisionAck(input: { outcome: ApprovalOutcome; applied: boolean; detail?: string }): string {
  if (input.detail) return truncateForTelegram(input.detail, TELEGRAM_CALLBACK_ANSWER_LIMIT);
  if (!input.applied) return "Already decided";
  return input.outcome === "approve" ? "Approved" : "Rejected";
}
// [END: module]
