import { useState } from "react";
import { linkyScopes } from "@linky/linksync";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useShardSummaries } from "../app/hooks/useLinksync";
import { forgetChatShards } from "../evolu";

export function ChatStoragePage(): React.ReactElement {
  const { t } = useAppShellCore();
  const messages = useShardSummaries().find(
    (shard) => shard.scope === "messages",
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const policy = linkyScopes.messages.forget;
  const keep = policy === "never" ? 0 : policy.keepNewest;
  const subscribed = messages?.visibleOwnerIds.length ?? 0;
  const forget = async () => {
    setBusy(true);
    setStatus("");
    try {
      await forgetChatShards();
      setStatus(t("chatStorageForgotten"));
    } catch {
      setStatus(t("chatStorageFailed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel settings-page">
      <p>{t("chatStoragePolicy").replace("{count}", String(keep))}</p>
      <div className="settings-row">
        <span>{t("chatStorageTotal")}</span>
        <span>{messages ? messages.index + 1 : t("unknown")}</span>
      </div>
      <div className="settings-row">
        <span>{t("chatStorageSubscribed")}</span>
        <span>{messages ? subscribed : t("unknown")}</span>
      </div>
      <p className="muted">{t("chatStorageForgetHint")}</p>
      <button
        type="button"
        className="btn-wide secondary"
        disabled={busy || subscribed <= keep}
        onClick={() => void forget()}
      >
        {t("chatStorageForget")}
      </button>
      <p role="status">{status}</p>
    </section>
  );
}
