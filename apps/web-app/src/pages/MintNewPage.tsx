import React from "react";
import { useAppShellCore } from "../app/context/AppShellContexts";
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
  const { t } = useAppShellCore();
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
    <section className="panel">
      <label htmlFor="mintUrl">{t("mintAddUrl")}</label>
      <input
        id="mintUrl"
        value={mintUrl}
        onChange={(e) => setMintUrl(e.target.value)}
        placeholder="https://…"
        disabled={isSaving}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
      />

      <div className="panel-header panel-header-layout">
        <button
          type="button"
          onClick={() => void addMint()}
          disabled={!mintUrl.trim() || cashuIsBusy || isSaving}
        >
          {t("mintAddButton")}
        </button>
      </div>
    </section>
  );
}
