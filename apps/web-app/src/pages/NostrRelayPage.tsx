import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRelaySettingsContext } from "../app/context/SystemSettingsContexts";
import { relayDotState, useRelayHealth } from "../app/hooks/useRelayHealth";
import { formatRelativeTime } from "../utils/formatting";

export function NostrRelayPage(): React.ReactElement {
  const {
    pendingRelayDeleteUrl,
    requestDeleteSelectedRelay,
    selectedRelayUrl,
  } = useRelaySettingsContext();
  const relayHealth = useRelayHealth();
  const { lang, t } = useAppShellCore();

  if (!selectedRelayUrl) {
    return (
      <section className="panel">
        <p className="lede">{t("errorPrefix")}</p>
      </section>
    );
  }

  const health = relayHealth.get(selectedRelayUrl);
  const dotState = relayDotState(health);
  const stateLabel =
    dotState === "connected"
      ? t("relayStateConnected")
      : dotState === "checking"
        ? t("relayStateConnecting")
        : t("relayStateUnreachable");
  const lastPublish = health?.lastPublish ?? null;

  return (
    <section className="panel">
      <div className="settings-row">
        <div className="settings-left">
          <span className="relay-url">{selectedRelayUrl}</span>
        </div>
        <div className="settings-right">
          <span
            className={`status-dot ${dotState}`}
            aria-label={dotState}
            title={dotState}
          />
        </div>
      </div>

      <div className="settings-row">
        <div className="settings-left">
          <span className="settings-label">{t("relayStatusLabel")}</span>
        </div>
        <div className="settings-right">
          <span className="muted">{stateLabel}</span>
        </div>
      </div>

      {health?.state === "unreachable" && health.detail ? (
        <p className="muted nostr-relay-note">{health.detail}</p>
      ) : null}

      {lastPublish ? (
        <div className="settings-row">
          <div className="settings-left">
            <span className="settings-label">{t("relayLastPublish")}</span>
          </div>
          <div className="settings-right">
            <span className="muted">
              {lastPublish.accepted
                ? t("relayPublishAccepted")
                : t("relayPublishRejected")}
              {" · "}
              {formatRelativeTime(lastPublish.at, lang)}
            </span>
          </div>
        </div>
      ) : null}

      <div className="settings-row">
        <button
          className={
            pendingRelayDeleteUrl === selectedRelayUrl
              ? "btn-wide danger"
              : "btn-wide"
          }
          onClick={requestDeleteSelectedRelay}
        >
          {t("delete")}
        </button>
      </div>
    </section>
  );
}
