import { Form, SubmitButton, TextField } from "@linky-fit/ui";
import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import {
  useAdvancedSettingsContext,
  useEvoluSettingsContext,
} from "../app/context/SystemSettingsContexts";
import { normalizeEvoluServerUrl } from "../evolu";
import { navigateTo } from "../hooks/useRouting";

export function EvoluServerNewPage(): React.ReactElement {
  const {
    evoluServerUrls,
    newEvoluServerUrl,
    saveEvoluServerUrls,
    setNewEvoluServerUrl,
    setStatus,
  } = useEvoluSettingsContext();
  const { t } = useAppShellCore();
  const { pushToast } = useAdvancedSettingsContext();

  const addServer = () => {
    const normalized = normalizeEvoluServerUrl(newEvoluServerUrl);
    if (!normalized) {
      pushToast(t("evoluAddServerInvalid"));
      return;
    }
    if (
      evoluServerUrls.some((u) => u.toLowerCase() === normalized.toLowerCase())
    ) {
      pushToast(t("evoluAddServerAlready"));
      navigateTo({ route: "relays" });
      return;
    }

    saveEvoluServerUrls([...evoluServerUrls, normalized]);
    setNewEvoluServerUrl("");
    setStatus(t("evoluAddServerSaved"));
    navigateTo({ route: "relays" });
  };

  return (
    <Form onSubmit={addServer}>
      <TextField
        label={t("evoluAddServerLabel")}
        id="evoluServerUrl"
        value={newEvoluServerUrl}
        onChangeText={setNewEvoluServerUrl}
        placeholder="wss://..."
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
      />
      <SubmitButton disabled={!normalizeEvoluServerUrl(newEvoluServerUrl)}>
        {t("evoluAddServerButton")}
      </SubmitButton>
    </Form>
  );
}
