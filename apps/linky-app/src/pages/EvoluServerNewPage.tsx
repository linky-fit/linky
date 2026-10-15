import { Form, SubmitButton, TextField } from "@linky-fit/ui";
import React from "react";
import { usePushToast, useTranslation } from "../app/hooks/shell";
import { useEvoluSettings } from "../app/hooks/settings/useEvoluSettings";
import { normalizeEvoluServerUrl } from "../evolu";
import { navigateTo } from "../hooks/useRouting";

export function EvoluServerNewPage(): React.ReactElement {
  const {
    evoluServerUrls,
    newEvoluServerUrl,
    saveEvoluServerUrls,
    setNewEvoluServerUrl,
    setStatus,
  } = useEvoluSettings();
  const { t } = useTranslation();
  const pushToast = usePushToast();

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
      navigateTo({ route: "evoluServers" });
      return;
    }

    saveEvoluServerUrls([...evoluServerUrls, normalized]);
    setNewEvoluServerUrl("");
    setStatus(t("evoluAddServerSaved"));
    navigateTo({ route: "evoluServers" });
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
