/**
 * FILE: ui/src/components/telegram/TelegramChannel.tsx
 * ABOUT: Operator settings for the Telegram approval channel.
 *
 * SECTIONS:
 *   [TAG: module] - TelegramChannel.tsx (components module).
 */
// ==========================================
// [META: module]
// INTENT: Connect a Telegram bot to this company, hand out one-time codes that bind a chat to the
//   signed-in operator, and revoke chats that should no longer be able to approve anything.
// PSEUDOCODE: 1. Read config + bindings. 2. Save a bot token (write-only; cleared from the field after).
//   3. Issue a link code and show it once. 4. List linked chats with a revoke button.
// JSON_FLOW: {"file": "ui/src/components/telegram/TelegramChannel.tsx", "imports": "react, @tanstack/react-query, ../../api/telegram", "exports": "TelegramChannel"}
// ==========================================
// [START: module]
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { telegramApi, type TelegramLinkCode } from "../../api/telegram";

export function TelegramChannel({ companyId }: { companyId: string }) {
  const qc = useQueryClient();
  const [botToken, setBotToken] = useState("");
  const [botUsername, setBotUsername] = useState("");
  const [publicBaseUrl, setPublicBaseUrl] = useState("");
  const [issued, setIssued] = useState<TelegramLinkCode | null>(null);
  // Telegram needs this as setWebhook's secret_token, and no read endpoint returns it — so the one
  // moment it can be shown is right after the save that minted it.
  const [webhookSecret, setWebhookSecret] = useState<string | null>(null);

  const { data: config } = useQuery({
    queryKey: ["telegram-config", companyId],
    queryFn: () => telegramApi.getConfig(companyId),
    enabled: Boolean(companyId),
  });
  const connected = config?.configured === true;

  // Seed the editable fields from whatever is already stored, once the config arrives.
  const savedBaseUrl = config?.configured ? (config.publicBaseUrl ?? "") : "";
  const savedUsername = config?.configured ? (config.botUsername ?? "") : "";
  useEffect(() => {
    setPublicBaseUrl(savedBaseUrl);
  }, [savedBaseUrl]);
  useEffect(() => {
    setBotUsername(savedUsername);
  }, [savedUsername]);

  const { data: bindings } = useQuery({
    queryKey: ["telegram-bindings", companyId],
    queryFn: () => telegramApi.listBindings(companyId),
    enabled: Boolean(companyId) && connected,
  });

  const save = useMutation({
    mutationFn: () =>
      telegramApi.putConfig(companyId, {
        botToken,
        botUsername: botUsername.trim() || null,
        publicBaseUrl: publicBaseUrl.trim() || null,
      }),
    onSuccess: (saved) => {
      // The token is write-only server-side; drop it from the field so it is not left on screen.
      setBotToken("");
      setWebhookSecret(saved.webhookSecret);
      void qc.invalidateQueries({ queryKey: ["telegram-config", companyId] });
    },
  });

  const disconnect = useMutation({
    mutationFn: () => telegramApi.removeConfig(companyId),
    onSuccess: () => {
      setIssued(null);
      setWebhookSecret(null);
      void qc.invalidateQueries({ queryKey: ["telegram-config", companyId] });
      void qc.invalidateQueries({ queryKey: ["telegram-bindings", companyId] });
    },
  });

  const createCode = useMutation({
    mutationFn: () => telegramApi.createLinkCode(companyId, {}),
    onSuccess: (code) => setIssued(code),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => telegramApi.revokeBinding(companyId, id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["telegram-bindings", companyId] }),
  });

  return (
    <section className="telegram-channel mt-6 border-t pt-4">
      <h2 className="text-lg font-medium">Telegram</h2>
      <p className="text-xs text-muted-foreground mt-1">
        {connected
          ? "Connected. High-risk approvals arrive in every linked chat with Approve and Reject buttons."
          : "Not connected. Add a bot token from @BotFather to approve from your phone."}
      </p>

      {connected && config.configured && (
        <p className="text-xs text-muted-foreground mt-2">
          Point the bot's webhook at <code>{config.webhookPath}</code>.
        </p>
      )}

      {webhookSecret && (
        <div className="mt-2 text-xs" data-testid="telegram-webhook-secret">
          <p>
            Webhook secret — copy it now, it is shown only once:{" "}
            <code>{webhookSecret}</code>
          </p>
          <p className="text-muted-foreground mt-1">
            Register it with Telegram, passing it as <code>secret_token</code> to{" "}
            <code>setWebhook</code>.
          </p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <input
          aria-label="Bot token"
          type="password"
          placeholder="123456789:ABC…"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
        />
        <input
          aria-label="Bot username"
          placeholder="acme_ops_bot"
          value={botUsername}
          onChange={(e) => setBotUsername(e.target.value)}
        />
        <input
          aria-label="Public base URL"
          placeholder="https://your-paperclip"
          value={publicBaseUrl}
          onChange={(e) => setPublicBaseUrl(e.target.value)}
        />
        <button
          data-testid="telegram-save"
          onClick={() => save.mutate()}
          disabled={!botToken.trim() || save.isPending}
        >
          {save.isPending ? "Saving…" : connected ? "Replace bot" : "Connect bot"}
        </button>
        {connected && (
          <button data-testid="telegram-disconnect" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
            Disconnect
          </button>
        )}
      </div>

      {connected && (
        <>
          <div className="mt-4 flex items-center gap-2">
            <button
              data-testid="telegram-link-code"
              onClick={() => createCode.mutate()}
              disabled={createCode.isPending}
            >
              {createCode.isPending ? "Issuing…" : "Link a chat"}
            </button>
            <span className="text-xs text-muted-foreground">
              One-time code, valid for an hour, binds that chat to you.
            </span>
          </div>

          {issued && (
            <p className="mt-2 text-xs" data-testid="telegram-fresh-code">
              Open{" "}
              {issued.deepLink ? (
                <code>{issued.deepLink}</code>
              ) : (
                <>
                  your bot and send <code>{`/start ${issued.code}`}</code>
                </>
              )}{" "}
              — shown only once.
            </p>
          )}

          <h3 className="font-medium mt-4">Linked chats</h3>
          {(bindings ?? []).length === 0 ? (
            <p className="text-xs text-muted-foreground">No chats linked yet.</p>
          ) : (
            <ul className="list-disc pl-5">
              {(bindings ?? []).map((b) => (
                <li key={b.id}>
                  {b.chatLabel ?? b.userId}{" "}
                  <span className="text-xs text-muted-foreground">
                    {b.lastUsedAt ? `last used ${new Date(b.lastUsedAt).toLocaleDateString()}` : "never used"}
                  </span>{" "}
                  <button data-testid={`revoke-${b.id}`} onClick={() => revoke.mutate(b.id)}>
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
// [END: module]
