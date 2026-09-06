import React, { useCallback, useMemo, useRef, useState } from "react";
import { Copy, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useAppShellCore } from "../app/context/AppShellContexts";
import { useAdvancedSettingsContext } from "../app/context/SystemSettingsContexts";
import {
  PasswordManagerSaveForm,
  type PasswordManagerSaveFormHandle,
} from "../components/PasswordManagerSaveForm";

export function MasterKeysPage(): React.ReactElement {
  const {
    copySeed,
    passwordManagerSeedUsername,
    pushToast,
    saveSeedToPasswordManager,
    seedMnemonic,
  } = useAdvancedSettingsContext();
  const { t } = useAppShellCore();
  const [isVisible, setIsVisible] = useState(false);
  const passwordManagerSaveFormRef =
    useRef<PasswordManagerSaveFormHandle | null>(null);
  const seedWords = useMemo(
    () =>
      (seedMnemonic ?? "")
        .trim()
        .split(/\s+/)
        .filter((word) => word.length > 0),
    [seedMnemonic],
  );
  const hasSeedMnemonic = seedWords.length > 0;

  const handleSaveSeed = useCallback(async () => {
    if (!hasSeedMnemonic) {
      pushToast(t("seedMissing"));
      return;
    }

    passwordManagerSaveFormRef.current?.requestSave();

    const result = await saveSeedToPasswordManager();
    if (result === "failed") {
      pushToast(t("onboardingBackupSaveFailed"));
      return;
    }

    if (result === "unsupported") {
      pushToast(t("onboardingBackupSaveUnavailable"));
      return;
    }

    if (result === "saved") {
      pushToast(t("onboardingBackupSaveRequested"));
    }
  }, [hasSeedMnemonic, pushToast, saveSeedToPasswordManager, t]);

  return (
    <section className="panel settings-page master-keys-page">
      <PasswordManagerSaveForm
        ref={passwordManagerSaveFormRef}
        username={passwordManagerSeedUsername}
        password={seedMnemonic ?? ""}
      />

      <div className="master-keys-word-grid" aria-live="polite">
        {hasSeedMnemonic ? (
          seedWords.map((word, index) => (
            <span
              className={
                isVisible
                  ? "master-keys-word"
                  : "master-keys-word master-keys-word-hidden"
              }
              key={index}
            >
              <span className="master-keys-word-index">{index + 1}</span>
              <span className="master-keys-word-value">
                {isVisible ? word : "****"}
              </span>
            </span>
          ))
        ) : (
          <p className="muted settings-note">{t("seedMissing")}</p>
        )}
      </div>

      <div className="master-keys-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => setIsVisible((current) => !current)}
          disabled={!hasSeedMnemonic}
        >
          {isVisible ? <EyeOff size={18} /> : <Eye size={18} />}
          <span>{isVisible ? t("masterKeysHide") : t("masterKeysShow")}</span>
        </button>

        <button
          type="button"
          onClick={copySeed}
          disabled={!hasSeedMnemonic}
          data-guide="copy-seed"
        >
          <Copy size={18} />
          <span>{t("copy")}</span>
        </button>

        <button
          type="button"
          className="secondary"
          onClick={() => void handleSaveSeed()}
          disabled={!hasSeedMnemonic}
        >
          <ShieldCheck size={18} />
          <span>{t("onboardingBackupSave")}</span>
        </button>
      </div>
    </section>
  );
}
