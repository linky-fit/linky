import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useRelaySettingsContext } from "../app/context/SystemSettingsContexts";

export function NostrRelayNewPage(): React.ReactElement {
  const { canSaveNewRelay, newRelayUrl, saveNewRelay, setNewRelayUrl } =
    useRelaySettingsContext();
  const { t } = useAppShellCore();
  return (
    <section className="panel">
      <label htmlFor="relayUrl">{t("relayUrl")}</label>
      <input
        id="relayUrl"
        value={newRelayUrl}
        onChange={(e) => setNewRelayUrl(e.target.value)}
        placeholder="wss://..."
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />

      <div className="panel-header panel-header-layout">
        {canSaveNewRelay ? (
          <button onClick={saveNewRelay}>{t("saveChanges")}</button>
        ) : null}
      </div>
    </section>
  );
}
