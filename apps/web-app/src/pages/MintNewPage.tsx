import { Button, Stack, TextField } from "@linky-fit/ui";
import React from "react";
import { useTranslation } from "../app/hooks/shell";
import { useMintSettingsContext } from "../app/context/SystemSettingsContexts";
import { navigateTo } from "../hooks/useRouting";
import {
  isHiddenTestMint,
  isTestMintUrl,
  normalizeMintUrl,
} from "../utils/mint";

const parseMintUrlInput = (value: string): string | null => {
  const trimmed = value.trim();
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const cleaned = normalizeMintUrl(withScheme);
  try {
    const { hostname } = new URL(cleaned);
    return hostname.includes(".") || isTestMintUrl(cleaned) ? cleaned : null;
  } catch {
    return null;
  }
};

export function MintNewPage(): React.ReactElement {
  const { allowTestMints, applyDefaultMintSelection, cashuIsBusy, setStatus } =
    useMintSettingsContext();
  const { t } = useTranslation();
  const [mintUrl, setMintUrl] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);

  const addMint = async () => {
    const cleaned = parseMintUrlInput(mintUrl);
    if (!cleaned) {
      setStatus(t("mintUrlInvalid"));
      return;
    }
    if (isHiddenTestMint(cleaned, allowTestMints)) {
      setStatus(t("mintTestMintNotAllowed"));
      return;
    }
    setIsSaving(true);
    const applied = await applyDefaultMintSelection(cleaned);
    setIsSaving(false);
    if (applied) navigateTo({ route: "mint", mintUrl: cleaned });
  };

  return (
    <Stack gap="$lg">
      <TextField
        id="mintUrl"
        label={t("mintAddUrl")}
        value={mintUrl}
        onChangeText={setMintUrl}
        placeholder="https://…"
        disabled={isSaving}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
      />
      <Button
        onPress={() => void addMint()}
        disabled={!mintUrl.trim() || cashuIsBusy || isSaving}
      >
        {t("mintAddButton")}
      </Button>
    </Stack>
  );
}
