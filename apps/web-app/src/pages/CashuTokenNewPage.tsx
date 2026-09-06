import type { FC, RefObject } from "react";
import { extractCashuTokenFromText } from "../app/lib/tokenText";
import type { Translate } from "../i18n";

interface CashuTokenNewPageProps {
  cashuDraft: string;
  cashuDraftRef: RefObject<HTMLTextAreaElement | null>;
  cashuIsBusy: boolean;
  saveCashuFromText: (
    text: string,
    opts: { navigateToTokens?: boolean; navigateToWallet?: boolean },
  ) => Promise<void>;
  setCashuDraft: (value: string) => void;
  t: Translate;
}

export const CashuTokenNewPage: FC<CashuTokenNewPageProps> = ({
  cashuDraft,
  cashuDraftRef,
  cashuIsBusy,
  saveCashuFromText,
  setCashuDraft,
  t,
}) => {
  const saveToken = (tokenRaw: string) =>
    void saveCashuFromText(tokenRaw, { navigateToTokens: true });

  // A complete token is saved as soon as it lands in the field, whether it
  // arrives via the paste event or a keyboard/IME insert that only fires change.
  const handleDraftChange = (value: string) => {
    const token = cashuIsBusy ? null : extractCashuTokenFromText(value);
    if (token) {
      saveToken(token);
      return;
    }
    setCashuDraft(value);
  };

  return (
    <section className="panel">
      <label>{t("cashuToken")}</label>
      <textarea
        ref={cashuDraftRef}
        value={cashuDraft}
        onChange={(e) => handleDraftChange(e.target.value)}
        placeholder={t("cashuPasteManualHint")}
      />

      <div className="settings-row">
        <button
          className="btn-wide"
          onClick={() => saveToken(cashuDraft)}
          disabled={!cashuDraft.trim() || cashuIsBusy}
        >
          {t("cashuSave")}
        </button>
      </div>
    </section>
  );
};
