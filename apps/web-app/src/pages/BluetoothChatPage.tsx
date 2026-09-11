import React from "react";
import { Send } from "lucide-react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useBluetooth } from "../bluetooth/BluetoothContext";
import { MAX_MESSAGE_BYTES } from "../bluetooth/mesh";
import { bluetoothStatusKey } from "../bluetooth/status";
import { navigateTo } from "../hooks/useRouting";

export function BluetoothChatPage() {
  const { t, lang } = useAppShellCore();
  const bluetooth = useBluetooth();
  const [draft, setDraft] = React.useState("");
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const bottom = React.useRef<HTMLDivElement>(null);
  const bytes = new TextEncoder().encode(draft.trim()).length;
  React.useEffect(() => {
    bottom.current?.scrollIntoView({ block: "end" });
  }, [bluetooth.messages.length]);

  const send = async () => {
    if (!draft.trim() || bytes > MAX_MESSAGE_BYTES || sending) return;
    setSending(true);
    setError(null);
    try {
      await bluetooth.sendMessage(draft.trim());
      setDraft("");
    } catch {
      setError(t("bluetoothSendFailed"));
    } finally {
      setSending(false);
    }
  };

  if (!bluetooth.available)
    return (
      <section className="panel">
        <p>{t("bluetoothUnsupported")}</p>
      </section>
    );
  return (
    <section className="bluetooth-room">
      <div className="bluetooth-room-info">
        <p>{t("bluetoothPublicNotice")}</p>
        <p role="status">
          {t(bluetoothStatusKey(bluetooth))} ·{" "}
          {t("bluetoothNearbyCount").replace(
            "{count}",
            String(bluetooth.nearbyCount),
          )}
        </p>
        {!bluetooth.enabled && (
          <button
            type="button"
            className="btn"
            onClick={() => navigateTo({ route: "settings" })}
          >
            {t("settings")}
          </button>
        )}
      </div>
      <div
        className="bluetooth-messages"
        role="log"
        aria-label={t("bluetoothRoom")}
      >
        {bluetooth.messages.length === 0 && (
          <p className="muted">{t("bluetoothNoMessages")}</p>
        )}
        {bluetooth.messages.map((message) => (
          <article
            key={message.id}
            className={`bluetooth-message${message.own ? " is-own" : ""}`}
          >
            <div className="bluetooth-message-meta">
              <strong>
                {message.nickname}{" "}
                <span className="muted">#{message.peerId.slice(0, 4)}</span>
              </strong>
              <time dateTime={new Date(message.timestamp).toISOString()}>
                {new Date(message.timestamp).toLocaleTimeString(lang, {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
            <p>{message.text}</p>
          </article>
        ))}
        <div ref={bottom} />
      </div>
      <form
        className="bluetooth-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label htmlFor="bluetooth-message" className="muted">
          {t("bluetoothMessageLimit").replace(
            "{count}",
            String(MAX_MESSAGE_BYTES),
          )}{" "}
          <span>
            {bytes}/{MAX_MESSAGE_BYTES}
          </span>
        </label>
        <div className="bluetooth-composer-row">
          <textarea
            id="bluetooth-message"
            rows={2}
            value={draft}
            maxLength={MAX_MESSAGE_BYTES}
            placeholder={t("bluetoothMessagePlaceholder")}
            disabled={!bluetooth.state.active || sending}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            type="submit"
            className="btn primary"
            aria-label={t("send")}
            disabled={
              !bluetooth.state.active ||
              bluetooth.nearbyCount === 0 ||
              sending ||
              bytes === 0 ||
              bytes > MAX_MESSAGE_BYTES
            }
          >
            <Send size={20} />
          </button>
        </div>
        {(error || bluetooth.error) && (
          <p role="alert">{error || bluetooth.error}</p>
        )}
      </form>
    </section>
  );
}
