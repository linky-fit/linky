import { Form, SubmitButton, TextField } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useRelaySettings } from "../app/hooks/settings/useRelaySettings";

export function NostrRelayNewPage(): React.ReactElement {
  const { canSaveNewRelay, newRelayUrl, saveNewRelay, setNewRelayUrl } =
    useRelaySettings();
  const { t } = useTranslation();
  return (
    <Form onSubmit={saveNewRelay}>
      <TextField
        label={t("relayUrl")}
        id="relayUrl"
        value={newRelayUrl}
        onChangeText={setNewRelayUrl}
        placeholder="wss://..."
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
      />
      <SubmitButton disabled={!canSaveNewRelay}>
        {t("saveChanges")}
      </SubmitButton>
    </Form>
  );
}
